import { Bot, Context, HTTP, Universal } from 'koishi';
import { WsClient } from '../ws';
import { QQGuildBot } from './guild';
import { QQMessageEncoder } from '../message';
import { GroupInternal } from '../internal';
import { HttpServer } from '../http';
import { decodeGroupChannel, decodeGroupGuild, decodeUser } from '../utils';
import * as AdapterConfig from '../config';
import { fromPrivateChannelId, isPrivateChannelId, toPrivateChannelId } from '../channel';

interface JoinRequestCache
{
  groupOpenid: string;
  memberOpenid: string;
}

interface GetAppAccessTokenResult
{
  access_token: string;
  expires_in: number;
}

export class QQBot<C extends Context = Context, T extends QQBot.Config = QQBot.Config> extends Bot<C, T>
{
  static MessageEncoder = QQMessageEncoder;
  static inject = {
    required: ['http', 'logger', 'database'],
    optional: ['server'],
  };

  public guildBot: QQGuildBot<C>;
  public selfOpenid?: string;

  internal: GroupInternal;
  http: HTTP;

  private _token?: string;
  private _disposeTokenRefresh?: () => void;
  private joinRequestMap = new Map<string, JoinRequestCache>();

  constructor(ctx: C, config: T)
  {
    super(ctx, config, 'qq');
    let endpoint = config.endpoint;
    if (config.sandbox)
    {
      endpoint = endpoint.replace(/^(https?:\/\/)/, '$1sandbox.');
    }
    this.http = this.ctx.http.extend({
      endpoint,
      headers: {
        'Authorization': '',
        'X-Union-Appid': this.config.id,
      },
    });

    this.ctx.plugin(QQGuildBot, {
      parent: this,
    });
    this.internal = new GroupInternal(this, () => this.http);
    if (config.protocol === 'websocket')
    {
      this.ctx.plugin(WsClient, this as QQBot<C, QQBot.Config & WsClient.Options>);
    } else
    {
      this.ctx.plugin(HttpServer, this);
    }
  }

  async initialize()
  {
    const user = await this.guildBot.internal.getMe();
    if (user.union_openid) this.selfOpenid = user.union_openid;
    if (!this.user) this.user = decodeUser(user);
    else Object.assign(this.user, decodeUser(user));
  }

  async stop()
  {
    this._disposeTokenRefresh?.();
    this.joinRequestMap.clear();
    if (this.guildBot)
    {
      delete this.ctx.bots[this.guildBot.sid];
    }
    await super.stop();
  }

  async _ensureAccessToken()
  {
    try
    {
      const result = await this.ctx.http<GetAppAccessTokenResult>('https://bots.qq.com/app/getAppAccessToken', {
        method: 'POST',
        data: {
          appId: this.config.id,
          clientSecret: this.config.secret,
        },
      });
      if (!result.data.access_token)
      {
        this.logger.warn(`POST https://bots.qq.com/app/getAppAccessToken response: %o, trace id: %s`, result.data, result.headers.get('x-tps-trace-id'));
        throw new Error('failed to refresh access token');
      }
      this._token = result.data.access_token;
      this.http.config.headers.Authorization = `QQBot ${this._token}`;
      this._disposeTokenRefresh?.();
      const delay = Math.max(1000, (result.data.expires_in - 40) * 1000);
      this._disposeTokenRefresh = this.ctx.setTimeout(() =>
      {
        void this._ensureAccessToken().catch((error) =>
        {
          this.logger.warn(error);
        });
      }, delay);
    } catch (e)
    {
      if (!this.ctx.http.isError(e) || !e.response) throw e;
      this.logger.warn(`POST https://bots.qq.com/app/getAppAccessToken response: %o, trace id: %s`, e.response.data, e.response.headers.get('x-tps-trace-id'));
      throw e;
    }
  }

  async getAccessToken()
  {
    if (!this._token)
    {
      await this._ensureAccessToken();
    }
    return this._token;
  }

  async prepareRequestAuthorization()
  {
    const token = await this.getAccessToken();
    this.http.config.headers.Authorization = `QQBot ${token}`;
  }

  async getWebSocketToken()
  {
    return `QQBot ${await this.getAccessToken()}`;
  }

  async getLogin()
  {
    return this.toJSON();
  }

  async getUser(userId: string, guildId?: string): Promise<Universal.User>
  {
    const api = this.config.userInfoApi || 'https://oiapi.net/api/Openid';
    const appid = this.config.id;
    if (appid && userId)
    {
      try
      {
        const response = await this.ctx.http.get(api, {
          params: {
            appid,
            openid: userId,
          },
        });
        if (response?.code === 1 && response?.data)
        {
          return {
            id: userId,
            name: response.data.nickname || userId,
            avatar: response.data.avatar || `https://q.qlogo.cn/qqapp/${appid}/${userId}/640`,
          };
        }
      } catch (error)
      {
        this.logger.warn(error);
      }
    }
    return {
      id: userId,
      name: userId,
      avatar: `https://q.qlogo.cn/qqapp/${appid}/${userId}/640`,
    };
  }

  async createDirectChannel(id: string)
  {
    return { id: toPrivateChannelId(id), type: Universal.Channel.Type.DIRECT };
  }

  async getChannel(channelId: string): Promise<Universal.Channel>
  {
    if (isPrivateChannelId(channelId))
    {
      const userId = fromPrivateChannelId(channelId);
      const user = await this.getUser(userId);
      return {
        id: channelId,
        type: Universal.Channel.Type.DIRECT,
        name: user.name ?? userId,
      };
    }
    const group = await this.internal.getGroupInfo(channelId);
    return decodeGroupChannel(group);
  }

  async getGuild(guildId: string): Promise<Universal.Guild>
  {
    if (isPrivateChannelId(guildId))
    {
      const userId = fromPrivateChannelId(guildId);
      const user = await this.getUser(userId);
      return {
        id: guildId,
        name: user.name ?? userId,
        avatar: user.avatar,
      };
    }
    const group = await this.internal.getGroupInfo(guildId);
    return decodeGroupGuild(group);
  }

  async getChannelList(guildId: string, next?: string): Promise<Universal.List<Universal.Channel>>
  {
    return { data: [await this.getChannel(guildId)] };
  }

  async muteGuildMember(guildId: string, userId: string, duration: number, reason?: string): Promise<void>
  {
    const op = duration <= 0
      ? 'del' as const
      : await this.resolveMuteOp(guildId, userId);
    await this.internal.setRestrictChatSetting(guildId, {
      members: [{
        op,
        member_openid: userId,
        mute_expire_at: duration > 0 ? new Date(Date.now() + duration).toISOString() : '',
      }],
    });
  }

  private async resolveMuteOp(guildId: string, userId: string): Promise<'add' | 'update'>
  {
    try
    {
      const setting = await this.internal.getRestrictChatSetting(guildId);
      return setting.members?.some(member => member.member_openid === userId) ? 'update' : 'add';
    } catch
    {
      return 'add';
    }
  }

  registerJoinRequest(groupOpenid: string, memberOpenid: string, joinRequestId: string)
  {
    this.joinRequestMap.set(joinRequestId, {
      groupOpenid,
      memberOpenid,
    });
  }

  async handleGuildMemberRequest(messageId: string, approve: boolean, comment?: string): Promise<void>
  {
    const request = this.joinRequestMap.get(messageId);
    if (!request) throw new Error(`cannot resolve join request: ${messageId}`);
    await this.internal.approveJoinRequest(request.groupOpenid, request.memberOpenid, {
      op: approve ? 'approve' : 'decline',
      join_request_id: messageId,
      reject_reason: approve ? undefined : comment,
      add_to_member_blacklist: false,
    });
    this.joinRequestMap.delete(messageId);
  }

  async deleteMessage(channelId: string, messageId: string): Promise<void>
  {
    if (isPrivateChannelId(channelId))
    {
      await this.internal.deletePrivateMessage(fromPrivateChannelId(channelId), messageId);
      return;
    }
    try
    {
      await this.internal.deleteMessage(channelId, messageId);
    } catch (e)
    {
      await this.internal.deletePrivateMessage(fromPrivateChannelId(channelId), messageId);
    }
  }
}

export namespace QQBot
{
  export type BaseConfig = AdapterConfig.BaseConfig;

  export type Config = AdapterConfig.Config;

  export const Config = AdapterConfig.Config;
}
