import { Bot, Context, h, Session, Universal } from 'koishi';
import * as QQ from './types';
import { QQBot } from './bot';
import { patchSessionBotRole, patchSessionUserName, scheduleUserNameWrite } from './user';
import { toPrivateChannelId } from './channel';
import
{
  extractQuotedReferenceFromExt,
  extractReferenceFromExt,
  registerMessageReference,
  resolveMessageIdByReference,
} from './reference';

export const decodeGuild = (guild: QQ.Guild): Universal.Guild => ({
  id: guild.id,
  name: guild.name,
  avatar: guild.icon,
});

export const decodeChannel = (channel: QQ.Channel): Universal.Channel => ({
  id: channel.id,
  name: channel.name,
  type: channel.type === QQ.ChannelType.TEXT ? Universal.Channel.Type.TEXT
    : channel.type === QQ.ChannelType.VOICE ? Universal.Channel.Type.VOICE
      : channel.type === QQ.ChannelType.GROUP ? Universal.Channel.Type.CATEGORY
        : Universal.Channel.Type.TEXT,
  parentId: channel.parent_id,
  position: channel.position,
});

export const decodeGroupChannel = (group: QQ.GroupInfo): Universal.Channel => ({
  id: group.group_openid,
  name: group.group_name,
  type: Universal.Channel.Type.TEXT,
});

export const decodeGroupGuild = (group: QQ.GroupInfo): Universal.Guild => ({
  id: group.group_openid,
  name: group.group_name,
});

export const decodeUser = (user: QQ.User): Universal.User => ({
  id: user.id,
  name: user.username,
  isBot: user.bot,
  avatar: user.avatar,
});

export const decodeGuildMember = (member: QQ.Member): Universal.GuildMember => ({
  user: member.user ? decodeUser(member.user) : undefined,
  nick: member.nick,
  roles: member.roles?.map(id => ({ id })),
  joinedAt: new Date(member.joined_at).valueOf(),
});

function decodeGroupMemberEvent(input: QQ.GroupMemberEvent)
{
  const user = input.user ? decodeUser(input.user) : { id: input.member_openid };
  const member = input.member ? decodeGuildMember(input.member) : {
    user,
    nick: user.name,
    roles: [],
    joinedAt: input.timestamp * 1000,
  };
  return {
    guild: input.guild ? decodeGuild(input.guild) : { id: input.group_openid },
    member,
    user,
  };
}

/**
 * 将 elements 里 at 机器人 openid 的元素替换成 h.at(selfId)。
 * QQ 开放平台下发的 at 用的是机器人 openid，而 Koishi 用 selfId（AppID）
 * 来判断是否被 at 自己，两者不一致会导致指令前缀匹配失败。
 */
function normalizeAtSelf(elements: h[], selfId: string, botOpenid: string): h[]
{
  return elements.map(el =>
  {
    if (el.type === 'at' && el.attrs?.id === botOpenid)
    {
      return h.at(selfId);
    }
    return el;
  });
}

function normalizeGroupMessageAtSelf(message: Universal.Message, selfId: string, botOpenid?: string)
{
  if (!botOpenid || !message.elements?.length) return;
  const elements = message.elements.slice();
  while (elements[0]?.type === 'text' && !elements[0].attrs?.content.trim()) elements.shift();
  message.elements = normalizeAtSelf(elements, selfId, botOpenid);
  message.content = message.elements.join('');
}

function resolveBotOpenid(input: QQ.UserMessage, bot: QQBot)
{
  const mention = input.mentions?.find(
    (m): m is { scope: 'single'; id: string; is_you?: boolean; } =>
      m.scope === 'single' && ('is_you' in m) && !!m.is_you,
  );
  return mention?.id ?? bot.selfOpenid;
}

function extractQuotedTreeContent(text: string)
{
  const normalized = text.replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');
  const contentLabel = /^\s*\[\u6d88\u606f\u5185\u5bb9\]\s*/;
  const stopPattern = /^\s*(?:\[\u6d88\u606f\u7c7b\u578b\]|\[\u5173\u8054\u6d88\u606f\]|---\s*第\d+条\s*---|===\s*\u6d88\u606f\b)/;
  const nestedStart = lines.findIndex(line => /^\s*---\s*第\d+条\s*---/.test(line));

  const extractFrom = (start: number) =>
  {
    if (start < 0 || start >= lines.length) return '';
    const content: string[] = [];
    for (let i = start; i < lines.length; i++)
    {
      const line = lines[i];
      if (i !== start && stopPattern.test(line)) break;
      content.push(i === start ? line.replace(contentLabel, '') : line);
    }
    return content.join('\n').replace(/\s+$/, '');
  };

  if (nestedStart >= 0)
  {
    for (let i = nestedStart + 1; i < lines.length; i++)
    {
      if (contentLabel.test(lines[i])) return extractFrom(i);
    }
  }
  for (let i = 0; i < lines.length; i++)
  {
    if (contentLabel.test(lines[i])) return extractFrom(i);
  }
  return text;
}

function extractQuotedContentFromRenderedTree(text: string)
{
  if (!text.includes('[消息内容]')) return text;
  const normalized = text.replace(/\r\n/g, '\n');
  const start = normalized.indexOf('[消息内容]');
  if (start < 0) return text;
  const lines = normalized.slice(start).split('\n');
  const content: string[] = [];
  const firstLine = lines.shift();
  if (!firstLine) return '';
  content.push(firstLine.replace(/^\[消息内容\]\s*/, ''));
  for (const line of lines)
  {
    if (/^\s*(?:\[消息类型\]|\[关联消息\]|---\s*第\d+条\s*---|===\s*消息\b)/.test(line)) break;
    content.push(line);
  }
  return content.join('\n').replace(/\s+$/, '');
}

function decodeQuotedElement(element: NonNullable<QQ.UserMessage['msg_elements']>[number])
{
  const nodes: h[] = [];
  for (const attachment of element.attachments ?? [])
  {
    if (attachment.content_type === 'file')
    {
      nodes.push(h.file(attachment.url, {
        filename: attachment.filename,
      }));
    } else if (attachment.content_type.startsWith('image/'))
    {
      nodes.push(h.image(attachment.url));
    } else if (attachment.content_type === 'voice')
    {
      nodes.push(h.audio(attachment.url));
    } else if (attachment.content_type === 'video')
    {
      nodes.push(h.video(attachment.url));
    }
  }
  if (typeof element.content === 'string' && element.content.length)
  {
    nodes.push(h.text(extractQuotedTreeContent(element.content)));
  }
  return nodes;
}

function stringifyQuotedElement(element: h)
{
  if (element.type === 'text') return element.attrs?.content || '';
  if (element.type === 'br') return '\n';
  if (element.type === 'at') return element.attrs?.type === 'all'
    ? '@everyone'
    : `<@${element.attrs?.id}>`;
  if (element.type === 'image' || element.type === 'img')
  {
    const src = element.attrs?.src || element.attrs?.url;
    return src ? `<img src="${src}">` : '';
  }
  return element.toString();
}

function extractQuotedContent(data: QQ.UserMessage)
{
  const elements = (data.msg_elements ?? []).flatMap(decodeQuotedElement);
  if (!elements.length) return;
  return {
    elements,
    content: elements.map(stringifyQuotedElement).join(''),
  };
}

export async function decodeGroupMessage(
  bot: QQBot,
  data: QQ.UserMessage,
  message: Universal.Message = {},
  payload: Universal.MessageLike = message,
)
{
  message.id = data.id;
  registerMessageReference(data.id, data.message_scene?.ext?.map(extractReferenceFromExt).find(Boolean));
  message.elements = [];
  const quotedReferenceId = data.message_scene?.ext?.map(extractQuotedReferenceFromExt).find(Boolean);
  const quotedMessageId = resolveMessageIdByReference(quotedReferenceId);
  const quotedContent = extractQuotedContent(data);
  if (quotedMessageId || quotedContent)
  {
    const quote: Partial<Universal.Message> = quotedMessageId && bot.getMessage
      ? await bot.getMessage(data.group_id, quotedMessageId).catch(() => ({ id: quotedMessageId }))
      : quotedMessageId
        ? { id: quotedMessageId }
        : {};
    if (quotedContent)
    {
      if (quotedContent.elements?.length) quote.elements = quotedContent.elements;
      if (quotedContent.content) quote.content = quotedContent.content;
    }
    message.quote = quote;
  }
  if (data.content.trim().length)
  {
    if (data.mentions?.length)
    {
      // 构建 mentions id 集合，用于识别 content 里的 <@id> 是否在 mentions 列表中
      const mentionIds = new Set(data.mentions
        .filter(m => m.scope === 'single')
        .map(m => m.id));
      const hasAll = data.mentions.some(m => m.scope === 'all');

      // 直接在原始 content 上按 <@id> / <@all> 分割，避免 h.escape 后正则复杂度问题
      const parts = data.content.split(/(<@[^>]+>)/);
      for (const part of parts)
      {
        if (!part.length) continue;
        const atMatch = /^<@([^>]+)>$/.exec(part);
        if (atMatch)
        {
          const id = atMatch[1];
          if (id === 'all' && hasAll)
          {
            message.elements.push(h('at', { type: 'all' }));
          } else if (mentionIds.has(id))
          {
            message.elements.push(h.at(id));
          } else
          {
            // 不在 mentions 列表里，当普通文本处理
            message.elements.push(h.text(part));
          }
        } else
        {
          message.elements.push(h.text(part));
        }
      }

      // 将 mentions 里的用户名写入数据库缓存
      if (!bot.config.disableUserNamePersist)
        for (const mention of data.mentions)
          if (mention.scope === 'single' && mention.username)
            scheduleUserNameWrite(bot, mention.id, mention.username);
    }
    else { message.elements.push(h.text(data.content)); }
  }
  for (const attachment of (data.attachments ?? []))
  {
    if (attachment.content_type === 'file')
    {
      message.elements.push(h.file(attachment.url, {
        filename: attachment.filename,
      }));
    } else if (attachment.content_type.startsWith('image/'))
    {
      message.elements.push(h.image(attachment.url));
    } else if (attachment.content_type === 'voice')
    {
      message.elements.push(h.audio(attachment.url));
    } else if (attachment.content_type === 'video')
    {
      message.elements.push(h.video(attachment.url));
    }
  }
  message.content = message.elements.join('');

  if (!payload) return message;
  let date = data.timestamp;
  if (date.includes('m='))
  {
    date = data.timestamp.slice(0, data.timestamp.indexOf('m=')).trim().replace(/\+(\d{4}) CST/, 'GMT+$1');
  }
  payload.timestamp = new Date(date).valueOf();
  payload.guild = data.group_id && { id: data.group_id };
  payload.user = {
    id: data.author.id,
    name: data.author.username,
    avatar: `https://q.qlogo.cn/qqapp/${bot.config.id}/${data.author.id}/640`,
  };
  return message;
}

export async function decodeMessage(
  bot: Bot,
  data: QQ.Message,
  message: Universal.Message = {},
  payload: Universal.MessageLike = message,
): Promise<Universal.Message>
{
  message.id = message.messageId = data.id;
  message.elements = [h.text(message.content)];
  const { attachments = [] } = data;
  if (attachments.length && !/\s$/.test(message.content)) message.content += ' ';
  message.elements.push(...attachments
    .filter(({ content_type }) => content_type.startsWith('image'))
    .map((attachment) => h.image('https://' + attachment.url)));
  message.content = message.elements.join('');

  if (data.message_reference)
  {
    message.quote = bot.getMessage
      ? await bot.getMessage(data.channel_id, data.message_reference.message_id)
      : { id: data.message_reference.message_id };
  }

  if (!payload) return message;
  payload.timestamp = new Date(data.timestamp).valueOf();
  payload.user = decodeUser(data.author);
  if (data.direct_message)
  {
    // real guild id, dm's fake guild id
    payload.guild = { id: `${data.src_guild_id}_${data.guild_id}` };
    payload.channel = { id: `${data.guild_id}_${data.channel_id}`, type: Universal.Channel.Type.DIRECT };
  } else
  {
    payload.guild = { id: data.guild_id };
    payload.channel = { id: data.channel_id, type: Universal.Channel.Type.TEXT };
  }
  return message;
}

export function setupReaction(session: Session, data: QQ.MessageReaction)
{
  session.userId = data.user_id;
  session.guildId = data.guild_id;
  session.channelId = data.channel_id;
  session.content = `${data.emoji.type}:${data.emoji.id}`;
  // https://bot.q.qq.com/wiki/develop/api/openapi/reaction/model.html#reactiontargettype
  session.messageId = data.target.id;
  session.isDirect = false;
  return session;
}

export async function adaptSession<C extends Context = Context>(bot: QQBot<C>, input: QQ.DispatchPayload)
{
  let session = bot.session();

  if (!['GROUP_AT_MESSAGE_CREATE', 'GROUP_MESSAGE_CREATE', 'GROUP_MEMBER_ADD', 'GROUP_MEMBER_UPDATE', 'GROUP_MEMBER_REMOVE',
    'C2C_MESSAGE_CREATE', 'FRIEND_ADD', 'FRIEND_DEL', 'GROUP_ADD_ROBOT', 'GROUP_DEL_ROBOT', 'INTERACTION_CREATE',
    'GROUP_JOIN_REQUEST', 'GROUP_MSG_RECEIVE', 'GROUP_MSG_REJECT'].includes(input.t))
  {
    session = bot.guildBot.session();
    session.setInternal(bot.guildBot.platform, input);
  } else
  {
    session.setInternal(bot.platform, input);
  }

  if (input.t === 'MESSAGE_CREATE' || input.t === 'AT_MESSAGE_CREATE' || input.t === 'DIRECT_MESSAGE_CREATE')
  {
    if (bot.config.type === 'private' && input.t === 'AT_MESSAGE_CREATE' && bot.config.intents & QQ.Intents.GUILD_MESSAGES) return;
    session.type = 'message';
    await decodeMessage(bot, input.d, session.event.message = {}, session.event);
  } else if (input.t === 'MESSAGE_REACTION_ADD')
  {
    if (input.d.target.type !== 'ReactionTargetType_MSG') return;
    setupReaction(session, input.d);
    session.type = 'reaction-added';
  } else if (input.t === 'MESSAGE_REACTION_REMOVE')
  {
    if (input.d.target.type !== 'ReactionTargetType_MSG') return;
    setupReaction(session, input.d);
    session.type = 'reaction-removed';
  } else if (input.t === 'CHANNEL_CREATE' || input.t === 'CHANNEL_UPDATE' || input.t === 'CHANNEL_DELETE')
  {
    session.type = {
      CHANNEL_CREATE: 'channel-added',
      CHANNEL_UPDATE: 'channel-updated',
      CHANNEL_DELETE: 'channel-deleted',
    }[input.t];
    session.guildId = input.d.guild_id;
    session.event.channel = decodeChannel(input.d);
  } else if (input.t === 'GUILD_CREATE' || input.t === 'GUILD_UPDATE' || input.t === 'GUILD_DELETE')
  {
    session.type = {
      GUILD_CREATE: 'guild-added',
      GUILD_UPDATE: 'guild-updated',
      GUILD_DELETE: 'guild-deleted',
    }[input.t];
    session.event.guild = decodeGuild(input.d);
  } else if (input.t === 'DIRECT_MESSAGE_DELETE' || input.t === 'MESSAGE_DELETE' || input.t === 'PUBLIC_MESSAGE_DELETE')
  {
    if (bot.config.type === 'private' && input.t === 'PUBLIC_MESSAGE_DELETE' && bot.config.intents & QQ.Intents.GUILD_MESSAGES) return;
    session.type = 'message-deleted';
    session.userId = input.d.message.author.id;
    session.operatorId = input.d.op_user.id;
    session.messageId = input.d.message.id;
    session.isDirect = input.d.message.direct_message;
    if (session.isDirect)
    {
      session.guildId = `${input.d.message.src_guild_id}_${input.d.message.guild_id}`;
      session.channelId = `${input.d.message.guild_id}_${input.d.message.channel_id}`;
    } else
    {
      session.guildId = input.d.message.guild_id;
      session.channelId = input.d.message.channel_id;
    }
  } else if (input.t === 'GROUP_AT_MESSAGE_CREATE')
  {
    session.type = 'message';
    session.isDirect = false;
    await decodeGroupMessage(bot, input.d, session.event.message = {}, session.event);
    session.channelId = session.guildId;
    // QQ 下发的 at 用的是机器人 openid，Koishi 用 selfId 判断是否 at 自己。
    normalizeGroupMessageAtSelf(session.event.message, session.selfId, resolveBotOpenid(input.d, bot));
    // 兜底补一个 at selfId，避免平台漏发识别信息。
    const alreadyAtBot = session.elements.some(el => el.type === 'at' && el.attrs?.id === session.selfId);
    if (!alreadyAtBot) session.elements.unshift(h.at(session.selfId));
  } else if (input.t === 'GROUP_MESSAGE_CREATE')
  {
    session.type = 'message';
    session.isDirect = false;
    await decodeGroupMessage(bot, input.d, session.event.message = {}, session.event);
    session.channelId = session.guildId;
    // 全量群消息里也要统一替换成 selfId。
    normalizeGroupMessageAtSelf(session.event.message, session.selfId, resolveBotOpenid(input.d, bot));
  } else if (input.t === 'C2C_MESSAGE_CREATE')
  {
    session.type = 'message';
    session.isDirect = true;
    await decodeGroupMessage(bot, input.d, session.event.message = {}, session.event);
    session.channelId = toPrivateChannelId(session.userId);
  } else if (input.t === 'FRIEND_ADD')
  {
    session.type = 'friend-added';
    session.timestamp = input.d.timestamp;
    session.userId = input.d.openid;
  } else if (input.t === 'FRIEND_DEL')
  {
    session.type = 'friend-deleted';
    session.timestamp = input.d.timestamp;
    session.userId = input.d.openid;
  } else if (input.t === 'GROUP_ADD_ROBOT')
  {
    session.type = 'guild-added';
    session.timestamp = input.d.timestamp * 1000;
    session.guildId = input.d.group_openid;
    session.operatorId = input.d.op_member_openid;
  } else if (input.t === 'GROUP_DEL_ROBOT')
  {
    session.type = 'guild-removed';
    session.timestamp = input.d.timestamp * 1000;
    session.guildId = input.d.group_openid;
    session.operatorId = input.d.op_member_openid;
  } else if (input.t === 'GROUP_MSG_RECEIVE' || input.t === 'GROUP_MSG_REJECT')
  {
    session.type = {
      GROUP_MSG_RECEIVE: 'group-msg-receive',
      GROUP_MSG_REJECT: 'group-msg-reject',
    }[input.t];
    session.timestamp = input.d.timestamp * 1000;
    session.guildId = input.d.group_openid;
    session.channelId = input.d.group_openid;
    session.isDirect = false;
    session.operatorId = input.d.op_member_openid;
  } else if (input.t === 'GROUP_JOIN_REQUEST')
  {
    session.type = 'guild-member-request';
    session.timestamp = input.d.timestamp
      ? input.d.timestamp * 1000
      : new Date(input.d.apply_at).valueOf();
    session.guildId = input.d.group_openid;
    session.channelId = input.d.group_openid;
    session.isDirect = false;
    session.userId = input.d.member_openid;
    session.messageId = input.d.join_request_id;
    session.operatorId = input.d.op_member_openid;
    session.content = input.d.verify_info?.verify_message
      ?? input.d.verify_info?.review_qa_list?.map(qa => `${qa.question}: ${qa.answer}`).join('\n')
      ?? '';
    session.event.user = {
      id: input.d.member_openid,
      name: input.d.username,
    };
    session.event.guild = {
      id: input.d.group_openid,
    };
    bot.registerJoinRequest(input.d.group_openid, input.d.member_openid, input.d.join_request_id);
  } else if (input.t === 'INTERACTION_CREATE')
  {
    session.type = 'interaction/button';
    session.userId = input.d.group_member_openid ?? input.d.user_openid ?? input.d.data.resolved.user_id;
    if (input.d.chat_type === QQ.ChatType.GROUP)
    {
      session.guildId = input.d.group_openid;
      session.channelId = input.d.group_openid;
      session.isDirect = false;
    } else if (input.d.chat_type === QQ.ChatType.CHANNEL)
    {
      session.channelId = input.d.channel_id;
      session.isDirect = false; // ?
    } else if (input.d.chat_type === QQ.ChatType.DIRECT)
    {
      session.isDirect = true;
      session.channelId = toPrivateChannelId(session.userId);
    }
    session.event.button = {
      id: input.d.data.resolved.button_id,
      // @ts-ignore
      data: input.d.data.resolved.button_data,
    };
    // session.messageId = input.d.id // event_id is not supported for sending message

    // {message: 'get header appid failed', code: 630006}
    // {"message":"check app privilege not pass","code":11253
    if (!bot.config.manualAcknowledge) bot.internal.acknowledgeInteraction(input.d.id, { code: 0 }).catch(() => { });
  } else if (input.t === 'GROUP_MEMBER_ADD' || input.t === 'GROUP_MEMBER_REMOVE' || input.t === 'GROUP_MEMBER_UPDATE'
    || input.t === 'GUILD_MEMBER_ADD' || input.t === 'GUILD_MEMBER_DELETE' || input.t === 'GUILD_MEMBER_UPDATE')
  {
    session.type = {
      GUILD_MEMBER_ADD: 'guild-member-added',
      GUILD_MEMBER_UPDATE: 'guild-member-updated',
      GUILD_MEMBER_DELETE: 'guild-member-removed',
      GROUP_MEMBER_ADD: 'guild-member-added',
      GROUP_MEMBER_UPDATE: 'guild-member-updated',
      GROUP_MEMBER_REMOVE: 'guild-member-removed',
    }[input.t];
    session.guildId = (input.d as QQ.GroupMemberEvent).group_openid || (input.d as QQ.MemberWithGuild).guild_id;
    session.channelId = session.guildId;
    session.timestamp = (input.d as QQ.GroupMemberEvent).timestamp
      ? (input.d as QQ.GroupMemberEvent).timestamp * 1000
      : Date.now();
    const { guild, member, user } = 'group_openid' in input.d
      ? decodeGroupMemberEvent(input.d)
      : {
        guild: { id: input.d.guild_id },
        member: decodeGuildMember(input.d),
        user: decodeUser(input.d.user),
      };
    session.event.guild = guild;
    session.event.member = member;
    session.event.user = user;
    if (!session.event.user.name && session.event.member.user?.name) session.event.user.name = session.event.member.user.name;
  } else
  {
    return;
  }
  await Promise.all([
    patchSessionUserName(bot, session),
    patchSessionBotRole(bot, session),
  ]);
  return session;
}
