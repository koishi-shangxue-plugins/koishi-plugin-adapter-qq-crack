import { Bot, h, Universal } from 'koishi';
import { resolveMessageReference } from './reference';

export interface SendResponseLike
{
  id?: string;
  timestamp?: string;
  ext_info?: {
    ref_idx?: string;
  };
}

// 发送接口只返回 id/timestamp 时，也补出 Satori message.create 需要的消息结构。
export function buildSendMessage(
  bot: Bot,
  response: SendResponseLike,
  content: string,
  channelId: string,
  guildId: string | undefined,
  isDirect: boolean,
  reference?: string,
): Universal.Message
{
  return {
    id: response.id,
    messageId: response.id,
    channel: {
      id: channelId,
      type: isDirect ? Universal.Channel.Type.DIRECT : Universal.Channel.Type.TEXT,
    },
    guild: guildId ? { id: guildId } : undefined,
    user: bot.user
      ? {
        id: bot.selfId,
        name: bot.user.name,
        avatar: bot.user.avatar,
      }
      : {
        id: bot.selfId,
        name: bot.selfId,
      },
    timestamp: response.timestamp
      ? new Date(response.timestamp).valueOf()
      : Date.now(),
    content: content || undefined,
    elements: content ? [h.text(content)] : [],
    ...(reference ? {
      quote: {
        id: resolveMessageReference(reference),
      },
    } : {}),
  };
}
