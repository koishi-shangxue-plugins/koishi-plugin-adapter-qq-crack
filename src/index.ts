import { Context, Session } from 'koishi';
import * as QQ from './types';
import { QQBot } from './bot';
import { GroupInternal, GuildInternal } from './internal';

export { QQ };

export * from './bot';
export * from './logger';
export * from './message';
export * from './utils';
export * from './ws';

export const name = 'adapter-qq-crack';
export const reusable = true;
export const filter = false;
export const inject = QQBot.inject;
export const Config = QQBot.Config;

export function apply(ctx: Context, config: QQBot.Config)
{
  return new QQBot(ctx, config);
}

export default {
  name,
  reusable,
  filter,
  inject,
  Config,
  apply,
};

type ParamCase<S extends string> =
  | S extends `${infer L}${infer R}`
  ? `${L extends '_' ? '-' : Lowercase<L>}${ParamCase<R>}`
  : S;

type QQEvents = {
  [T in keyof QQ.GatewayEvents as `qq/${ParamCase<T>}`]: (input: QQ.GatewayEvents[T]) => void
};

declare module '@satorijs/core' {
  interface Session
  {
    qq?: QQ.Payload & GroupInternal;
    qqguild?: QQ.Payload & GuildInternal;
  }
}

declare module 'cordis' {
  interface Events extends QQEvents
  {
    'group-msg-receive'(session: Session): void;
    'group-msg-reject'(session: Session): void;
  }
}
