import { Bot, Dict, HTTP, makeArray } from 'koishi';
import { logDebug } from '../logger';

interface AuthorizationBot extends Bot
{
  prepareRequestAuthorization: () => Promise<void>;
}

function hasAuthorizationHook(bot: Bot): bot is AuthorizationBot
{
  const target = bot as Bot & { prepareRequestAuthorization?: unknown; };
  return typeof target.prepareRequestAuthorization === 'function';
}

function getAuthorizationHost(bot: Bot)
{
  if (hasAuthorizationHook(bot)) return bot;
  const target = bot as Bot & { parent?: Bot; };
  if (target.parent && hasAuthorizationHook(target.parent))
  {
    return target.parent;
  }
}

export class Internal
{
  constructor(private bot: Bot, private http: () => HTTP) { }

  getBot(): Bot
  {
    return this.bot;
  }

  static define(isGuild: boolean, routes: Dict<Partial<Record<HTTP.Method, string | string[]>>>, preset?: HTTP.RequestConfig)
  {
    for (const path in routes)
    {
      for (const key in routes[path])
      {
        const method = key as HTTP.Method;
        for (const name of makeArray(routes[path][method]))
        {
          (isGuild ? GuildInternal : GroupInternal).prototype[name] = async function (this: Internal, ...args: unknown[])
          {
            const raw = args.join(', ');
            const url = path.replace(/\{([^}]+)\}/g, () =>
            {
              if (!args.length) throw new Error(`too few arguments for ${path}, received ${raw}`);
              const value = args.shift();
              return String(value);
            });
            const config: HTTP.RequestConfig = { ...preset };
            if (args.length === 1)
            {
              if (method === 'GET' || method === 'DELETE')
              {
                config.params = args[0] as Dict;
              } else
              {
                config.data = args[0];
              }
            } else if (args.length === 2 && method !== 'GET' && method !== 'DELETE')
            {
              config.data = args[0];
              config.params = args[1] as Dict;
            } else if (args.length > 1)
            {
              throw new Error(`too many arguments for ${path}, received ${raw}`);
            }
            const authorizationHost = getAuthorizationHost(this.bot);
            if (authorizationHost)
            {
              await authorizationHost.prepareRequestAuthorization();
            }
            const http = this.http();
            try
            {
              logDebug(this.bot, `${method} ${url} request: %o`, config);
              const response = await http(url, { ...config, method });
              logDebug(this.bot, `${method} ${url} response: %o, trace id: %s`, response.data, response.headers.get('x-tps-trace-id'));
              return response.data;
            } catch (error)
            {
              if (!http.isError(error) || !error.response) throw error;
              logDebug(this.bot, `${method} ${url} response: %o, trace id: %s`, error.response.data, error.response.headers.get('x-tps-trace-id'));
              throw error;
            }
          };
        }
      }
    }
  }
}

export class GroupInternal extends Internal { }

export class GuildInternal extends Internal { }
