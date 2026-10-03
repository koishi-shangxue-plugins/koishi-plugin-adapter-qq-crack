import { Bot, Context, HTTP, Universal } from 'koishi';
import { QQBot } from '.';
import { decodeChannel, decodeGuild, decodeGuildMember, decodeMessage, decodeUser } from '../utils';
import { GuildInternal } from '../internal';
import { QQGuildMessageEncoder } from '../message';
import * as QQ from '../types';
import { isPrivateChannelId } from '../channel';

export namespace QQGuildBot
{
  export interface Config
  {
    parent: QQBot;
  }
}

/** updateChannel 可改的字段：Universal 字段 + 官方 PATCH 支持的 private_type / speak_permission */
export type GuildChannelUpdate = Partial<Universal.Channel> & Partial<Pick<QQ.Channel,
  'private_type' | 'speak_permission'>>;

/** createChannel 除 updateChannel 的字段外，还能在建频道时指定的 QQ 子频道字段 */
export type GuildChannelData = GuildChannelUpdate & Partial<Pick<QQ.Channel,
  'sub_type' | 'application_id'>> & {
    private_user_ids?: string[];
  };

/** 子频道专属能力只对真实子频道有意义，私聊频道与频道私信一律拒绝 */
function assertGuildChannelId(channelId: string, method: string)
{
  if (isPrivateChannelId(channelId))
  {
    throw new Error(`${method} 仅支持子频道，不支持私聊频道 ${channelId}`);
  }
  if (channelId.includes('_'))
  {
    throw new Error(`${method} 仅支持子频道，不支持频道私信 ${channelId}`);
  }
}

export class QQGuildBot<C extends Context = Context> extends Bot<C>
{
  declare parent: QQBot;
  hidden = true;
  public internal: GuildInternal;
  public http: HTTP;
  static MessageEncoder = QQGuildMessageEncoder;

  constructor(ctx: C, config: QQGuildBot.Config)
  {
    super(ctx, config, 'qq');
    this.parent = config.parent;
    this.parent.guildBot = this;
    this.platform = 'qqguild';
    this.internal = new GuildInternal(this, () => config.parent.http);
    this.http = config.parent.http;
  }

  get status()
  {
    return this.parent.status;
  }

  set status(status)
  {
    this.parent.status = status;
  }

  async getUser(userId: string, guildId?: string): Promise<Universal.User>
  {
    const { user } = await this.getGuildMember(guildId, userId);
    return user;
  }

  async getGuildList(next?: string)
  {
    const limit = 100;
    const guilds = await this.internal.getGuilds({
      ...(next ? { after: next } : {}),
      limit,
    });
    return {
      data: guilds.map(decodeGuild),
      next: guilds.length === limit ? guilds[guilds.length - 1].id : undefined,
    };
  }

  async getGuild(guildId: string)
  {
    if (isPrivateChannelId(guildId)) return this.parent.getGuild(guildId);
    const guild = await this.internal.getGuild(guildId);
    return decodeGuild(guild);
  }

  async getChannelList(guildId: string, next?: string): Promise<Universal.List<Universal.Channel>>
  {
    if (isPrivateChannelId(guildId)) return this.parent.getChannelList(guildId, next);
    const channels = await this.internal.getChannels(guildId);
    return { data: channels.map(decodeChannel) };
  }

  async getChannel(channelId: string): Promise<Universal.Channel>
  {
    if (isPrivateChannelId(channelId)) return this.parent.getChannel(channelId);
    const channel = await this.internal.getChannel(channelId);
    return decodeChannel(channel);
  }

  async createChannel(guildId: string, data: GuildChannelData)
  {
    const channel = await this.internal.createGuildChannel(guildId, {
      name: data.name,
      type: data.type === Universal.Channel.Type.TEXT ? QQ.ChannelType.TEXT
        : data.type === Universal.Channel.Type.CATEGORY ? QQ.ChannelType.GROUP
          : data.type === Universal.Channel.Type.VOICE ? QQ.ChannelType.VOICE
            : QQ.ChannelType.TEXT,
      parent_id: data.parentId,
      position: data.position,
      sub_type: data.sub_type ?? QQ.ChannelSubType.IDLE,
      private_type: data.private_type ?? QQ.ChannelPrivateType.PUBLIC,
      speak_permission: data.speak_permission ?? QQ.ChannelSpeakPermission.ALL,
      private_user_ids: data.private_user_ids ?? [],
      application_id: data.application_id,
    });
    return decodeChannel(channel);
  }

  // Koishi 的 Universal 协议把 updateChannel 的返回值固定为 void，因此这里不返回 decodeChannel 的结果
  async updateChannel(channelId: string, data: GuildChannelUpdate): Promise<void>
  {
    assertGuildChannelId(channelId, 'updateChannel');
    await this.internal.modifyChannel(channelId, {
      name: data.name,
      position: data.position,
      parent_id: data.parentId,
      private_type: data.private_type,
      speak_permission: data.speak_permission,
    });
  }

  async deleteChannel(channelId: string): Promise<void>
  {
    assertGuildChannelId(channelId, 'deleteChannel');
    await this.internal.deleteChannel(channelId);
  }

  /** 映射为频道全员禁言：QQ 没有子频道级禁言，enable 为 false 时传 '0' 解除 */
  async muteChannel(channelId: string, guildId?: string, enable = true): Promise<void>
  {
    assertGuildChannelId(channelId, 'muteChannel');
    const targetGuildId = guildId ?? (await this.internal.getChannel(channelId)).guild_id;
    await this.internal.muteGuildOrMembers(targetGuildId, {
      mute_seconds: enable === false ? '0' : '2592000',
    });
  }

  async getChannelOnlineNums(channelId: string): Promise<number>
  {
    assertGuildChannelId(channelId, 'getChannelOnlineNums');
    const { online_nums } = await this.internal.getChannelOnlineNums(channelId);
    return online_nums;
  }

  async getChannelUserPermissions(channelId: string, userId: string): Promise<QQ.ChannelPermissions>
  {
    assertGuildChannelId(channelId, 'getChannelUserPermissions');
    return this.internal.getChannelMemberPermissions(channelId, userId);
  }

  async setChannelUserPermissions(channelId: string, userId: string, data: QQ.UpdateChannelPermissions): Promise<void>
  {
    assertGuildChannelId(channelId, 'setChannelUserPermissions');
    await this.internal.modifyChannelMemberPermissions(channelId, userId, data);
  }

  async getChannelRolePermissions(channelId: string, roleId: string): Promise<QQ.ChannelPermissions>
  {
    assertGuildChannelId(channelId, 'getChannelRolePermissions');
    return this.internal.getChannelRole(channelId, roleId);
  }

  async setChannelRolePermissions(channelId: string, roleId: string, data: QQ.UpdateChannelPermissions): Promise<void>
  {
    assertGuildChannelId(channelId, 'setChannelRolePermissions');
    await this.internal.modifyChannelRole(channelId, roleId, data);
  }

  async setChannelMic(channelId: string): Promise<void>
  {
    assertGuildChannelId(channelId, 'setChannelMic');
    await this.internal.setChannelMic(channelId);
  }

  async removeChannelMic(channelId: string): Promise<void>
  {
    assertGuildChannelId(channelId, 'removeChannelMic');
    await this.internal.removeChannelMic(channelId);
  }

  async controlChannelAudio(channelId: string, data: QQ.AudioControl): Promise<void>
  {
    assertGuildChannelId(channelId, 'controlChannelAudio');
    await this.internal.controlChannelAudio(channelId, data);
  }

  async getGuildMemberList(guildId: string, next?: string): Promise<Universal.List<Universal.GuildMember>>
  {
    const members = await this.internal.getGuildMembers(guildId, {
      limit: 400,
      after: next,
    });
    return { data: members.map(decodeGuildMember), next: members[members.length - 1].user.id };
  }

  async getGuildMember(guildId: string, userId: string): Promise<Universal.GuildMember>
  {
    const member = await this.internal.getGuildMember(guildId, userId);
    return decodeGuildMember(member);
  }

  async kickGuildMember(guildId: string, userId: string)
  {
    await this.internal.removeGuildMember(guildId, userId);
  }

  async muteGuildMember(guildId: string, userId: string, duration: number)
  {
    await this.internal.muteGuildMember(guildId, userId, {
      mute_seconds: Math.floor(duration / 1000),
    });
  }

  async getReactionList(channelId: string, messageId: string, emoji: string, next?: string): Promise<Universal.List<Universal.User>>
  {
    const [type, id] = emoji.split(':');
    const { users, cookie } = await this.internal.getReactions(channelId, messageId, type, id, {
      limit: 50,
      cookie: next,
    });
    return { next: cookie, data: users.map(decodeUser) };
  }

  async createReaction(channelId: string, messageId: string, emoji: string)
  {
    const [type, id] = emoji.split(':');
    await this.internal.createReaction(channelId, messageId, type, id);
  }

  async deleteReaction(channelId: string, messageId: string, emoji: string)
  {
    const [type, id] = emoji.split(':');
    await this.internal.deleteReaction(channelId, messageId, type, id);
  }

  async getMessage(channelId: string, messageId: string): Promise<Universal.Message>
  {
    const r = await this.internal.getMessage(channelId, messageId);
    return decodeMessage(this, r.message);
  }

  async deleteMessage(channelId: string, messageId: string)
  {
    if (isPrivateChannelId(channelId))
    {
      await this.parent.deleteMessage(channelId, messageId);
    } else if (channelId.includes('_'))
    {
      // direct message
      const [guildId] = channelId.split('_');
      await this.internal.deleteDM(guildId, messageId);
    } else
    {
      await this.internal.deleteMessage(channelId, messageId);
    }
  }

  async getLogin(): Promise<Universal.Login>
  {
    return this.parent.getLogin();
  }

  async createDirectChannel(id: string, guild_id?: string)
  {
    let input_guild_id = guild_id;
    if (guild_id?.includes('_')) input_guild_id = guild_id.split('_')[0]; // call sendPM directly from DM channel
    const dms = await this.internal.createDMS({
      recipient_id: id,
      source_guild_id: input_guild_id,
    });
    return { id: `${dms.guild_id}_${input_guild_id}`, type: Universal.Channel.Type.DIRECT };
  }
}
