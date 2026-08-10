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

const userNameCache = new Map<string, CachedUserName>();
const pendingUserNameReads = new Map<string, Promise<string>>();
const pendingUserNameWrites = new Map<string, PendingUserNameWrite>();

function getCacheKey(platform: string, userId: string)
{
  return `${platform}:${userId}`;
}

function getCachedUserName(platform: string, userId: string)
{
  const key = getCacheKey(platform, userId);
  const cached = userNameCache.get(key);
  if (!cached) return;
  if (cached.expiresAt <= Date.now())
  {
    userNameCache.delete(key);
    return;
  }
  return cached.name;
}

function setCachedUserName(platform: string, userId: string, name: string)
{
  userNameCache.set(getCacheKey(platform, userId), {
    name,
    expiresAt: Date.now() + USERNAME_CACHE_TTL,
  });
}

function ensureSessionUser(session: Session)
{
  session.event.user ||= { id: session.userId };
  session.event.user.id ||= session.userId;
  return session.event.user;
}

async function loadUserName(bot: QQBot, userId: string)
{
  const database = bot.ctx.get('database');
  if (!database) return;

  const platform = bot.platform;
  const cached = getCachedUserName(platform, userId);
  if (cached) return cached;

  const key = getCacheKey(platform, userId);
  const pending = pendingUserNameReads.get(key);
  if (pending) return pending;

  const task = (async () =>
  {
    const user = await database.getUser(platform, userId, ['name']);
    if (!user?.name) return '';
    setCachedUserName(platform, userId, user.name);
    return user.name;
  })().finally(() =>
  {
    pendingUserNameReads.delete(key);
  });

  pendingUserNameReads.set(key, task);
  return task;
}

export function scheduleUserNameWrite(bot: QQBot, userId: string, name: string)
{
  const platform = bot.platform;
  setCachedUserName(platform, userId, name);
  const database = bot.ctx.get('database');
  if (!database) return;

  const key = getCacheKey(platform, userId);
  const pending = pendingUserNameWrites.get(key);
  if (pending?.name === name) return;
  pending?.dispose();

  const dispose = bot.ctx.setTimeout(async () =>
  {
    pendingUserNameWrites.delete(key);
    try
    {
      const user = await database.getUser(platform, userId, ['name']);
      if (user)
      {
        if (user.name === name) return;
        await database.setUser(platform, userId, { name });
        return;
      }
      await database.createUser(platform, userId, {
        name,
        flag: 0,
        authority: bot.ctx.root.config.autoAuthorize || 1,
        locales: [],
        permissions: [],
        createdAt: new Date(),
      });
    } catch (error)
    {
      bot.logger.warn(error);
    }
  }, USERNAME_WRITE_DELAY);

  pendingUserNameWrites.set(key, { name, dispose });
}

export async function patchSessionUserName(bot: QQBot, session: Session)
{
  if (!session.userId) return;

  const directName = session.event.user?.name?.trim();
  if (directName)
  {
    ensureSessionUser(session).name = directName;
    const cfg = bot.config as BaseConfig;
    if (!cfg.disableUserNamePersist)
    {
      scheduleUserNameWrite(bot, session.userId, directName);
    }
    return;
  }

  let userInfo: { name?: string; avatar?: string; };
  try
  {
    userInfo = await bot.getUser(session.userId, session.guildId);
  } catch (error)
  {
    bot.logger.warn(error);
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
      const cfg = bot.config as BaseConfig;
      if (!cfg.disableUserNamePersist)
      {
        scheduleUserNameWrite(bot, session.userId, user.name);
      }
      return;
    }
  }

  const cachedName = getCachedUserName(bot.platform, session.userId);
  if (cachedName)
  {
    ensureSessionUser(session).name = cachedName;
    return;
  }

  const storedName = await loadUserName(bot, session.userId);
  if (storedName)
  {
    ensureSessionUser(session).name = storedName;
  }
}
