import { Session } from 'koishi';
import { QQBot } from './bot';
import { BaseConfig } from './config';

const USERNAME_CACHE_TTL = 10 * 60 * 1000;
const USERNAME_WRITE_DELAY = 1000;

interface CachedUserName
{
  name: string;
  expiresAt: number;
}

interface PendingUserNameWrite
{
  name: string;
  dispose: () => void;
}

const userNameStores = new WeakMap<QQBot, UserNameStore>();

function ensureSessionUser(session: Session)
{
  session.event.user ||= { id: session.userId };
  session.event.user.id ||= session.userId;
  return session.event.user;
}

function isSelfUser(bot: QQBot, userId: string)
{
  return userId === bot.selfId
    || userId === bot.config.id
    || userId === bot.selfOpenid
    || userId === bot.user?.id;
}

class UserNameStore
{
  private readonly cache = new Map<string, CachedUserName>();
  private readonly pendingReads = new Map<string, Promise<string>>();
  private readonly pendingWrites = new Map<string, PendingUserNameWrite>();
  private disposed = false;

  constructor(private readonly bot: QQBot)
  {
    // 用户名缓存和延迟写入跟随 bot 生命周期释放。
    bot.ctx.on('dispose', () => this.dispose());
  }

  private getCached(userId: string)
  {
    const cached = this.cache.get(userId);
    if (!cached) return;
    if (cached.expiresAt <= Date.now())
    {
      this.cache.delete(userId);
      return;
    }
    return cached.name;
  }

  private setCached(userId: string, name: string)
  {
    this.cache.set(userId, {
      name,
      expiresAt: Date.now() + USERNAME_CACHE_TTL,
    });
  }

  async load(userId: string)
  {
    if (this.disposed || isSelfUser(this.bot, userId)) return;

    const cached = this.getCached(userId);
    if (cached) return cached;

    const pending = this.pendingReads.get(userId);
    if (pending) return pending;

    const database = this.bot.ctx.get('database');
    if (!database) return;

    const task = (async () =>
    {
      const user = await database.getUser(this.bot.platform, userId, ['name']);
      if (!user?.name || this.disposed) return '';
      this.setCached(userId, user.name);
      return user.name;
    })().finally(() =>
    {
      this.pendingReads.delete(userId);
    });

    this.pendingReads.set(userId, task);
    return task;
  }

  schedule(userId: string, name: string)
  {
    name = name.trim();
    if (!name || this.disposed || isSelfUser(this.bot, userId)) return;

    this.setCached(userId, name);
    const database = this.bot.ctx.get('database');
    if (!database) return;

    const pending = this.pendingWrites.get(userId);
    if (pending?.name === name) return;
    pending?.dispose();

    const dispose = this.bot.ctx.setTimeout(() =>
    {
      this.pendingWrites.delete(userId);
      void this.persist(userId, name);
    }, USERNAME_WRITE_DELAY);

    this.pendingWrites.set(userId, { name, dispose });
  }

  private async persist(userId: string, name: string)
  {
    if (this.disposed) return;

    const database = this.bot.ctx.get('database');
    if (!database) return;

    try
    {
      const user = await database.getUser(this.bot.platform, userId, ['name']);
      // 用户记录和绑定由统计插件创建，这里只补充已有用户的名称。
      if (!user || this.disposed || user.name === name) return;
      await database.setUser(this.bot.platform, userId, { name });
    } catch (error)
    {
      this.bot.logger.warn(error);
    }
  }

  async patchSession(session: Session)
  {
    if (!session.userId || isSelfUser(this.bot, session.userId)) return;

    const directName = session.event.user?.name?.trim();
    if (directName)
    {
      ensureSessionUser(session).name = directName;
      const config = this.bot.config as BaseConfig;
      if (!config.disableUserNamePersist) this.schedule(session.userId, directName);
      return;
    }

    let userInfo: { name?: string; avatar?: string; };
    try
    {
      userInfo = await this.bot.getUser(session.userId, session.guildId);
    } catch (error)
    {
      this.bot.logger.warn(error);
    }
    if (userInfo)
    {
      const user = ensureSessionUser(session);
      if (!user.name && userInfo.name) user.name = userInfo.name;
      if (!user.avatar && userInfo.avatar) user.avatar = userInfo.avatar;
      if (session.event.member?.user)
      {
        if (!session.event.member.user.name && userInfo.name) session.event.member.user.name = userInfo.name;
        if (!session.event.member.user.avatar && userInfo.avatar) session.event.member.user.avatar = userInfo.avatar;
      }
      if (user.name)
      {
        const config = this.bot.config as BaseConfig;
        if (!config.disableUserNamePersist) this.schedule(session.userId, user.name);
        return;
      }
    }

    const cachedName = this.getCached(session.userId);
    if (cachedName)
    {
      ensureSessionUser(session).name = cachedName;
      return;
    }

    const storedName = await this.load(session.userId);
    if (storedName)
    {
      ensureSessionUser(session).name = storedName;
    }
  }

  private dispose()
  {
    if (this.disposed) return;
    this.disposed = true;
    for (const pending of this.pendingWrites.values()) pending.dispose();
    this.pendingWrites.clear();
    this.pendingReads.clear();
    this.cache.clear();
    userNameStores.delete(this.bot);
  }
}

function getUserNameStore(bot: QQBot)
{
  let store = userNameStores.get(bot);
  if (!store)
  {
    store = new UserNameStore(bot);
    userNameStores.set(bot, store);
  }
  return store;
}

export function scheduleUserNameUpdate(bot: QQBot, userId: string, name: string)
{
  getUserNameStore(bot).schedule(userId, name);
}

export async function patchSessionUserName(bot: QQBot, session: Session)
{
  await getUserNameStore(bot).patchSession(session);
}
