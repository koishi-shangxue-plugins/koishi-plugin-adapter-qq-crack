import * as QQ from '../types';
import { GroupInternal } from '.';
import type { QQBot } from '../bot';

declare module './internal' {
  interface GroupInternal
  {
    sendMessage(channel_id: string, data: QQ.Message.Request): Promise<QQ.Message.SendResponse>;
    sendPrivateMessage(openid: string, data: QQ.Message.Request): Promise<QQ.Message.SendResponse>;
    sendFilePrivate(openid: string, data: QQ.Message.File.Request): Promise<any>;
    sendFileGuild(group_openid: string, data: QQ.Message.File.Request): Promise<any>;
    completeUploadPrivate(openid: string, data: QQ.Message.File.CompleteUploadRequest): Promise<QQ.Message.File.Response>;
    completeUploadGuild(group_openid: string, data: QQ.Message.File.CompleteUploadRequest): Promise<QQ.Message.File.Response>;
    uploadPreparePrivate(openid: string, data: QQ.Message.File.UploadPrepareRequest): Promise<QQ.Message.File.UploadPrepareResponse>;
    uploadPartFinishPrivate(openid: string, data: QQ.Message.File.UploadPartFinishRequest): Promise<any>;
    uploadPrepareGuild(group_openid: string, data: QQ.Message.File.UploadPrepareRequest): Promise<QQ.Message.File.UploadPrepareResponse>;
    uploadPartFinishGuild(group_openid: string, data: QQ.Message.File.UploadPartFinishRequest): Promise<any>;
    acknowledgeInteraction(interaction_id: string, data: {
      code: number;
    }): Promise<any>;
    getGateway(): Promise<QQ.GetGatewayResponse>;
    getGatewayBot(): Promise<QQ.GetGatewayBotResponse>;
    deleteMessage(openid: string, message_id: string): Promise<any>;
    deletePrivateMessage(userid: string, message_id: string): Promise<any>;
    getGroupInfo(group_openid: string): Promise<QQ.GroupInfo>;
    getBotGroupState(group_openid: string): Promise<QQ.BotGroupState>;
    getJoinRequestList(group_openid: string, params?: Partial<{
      cursor: string;
      limit: number;
    }>): Promise<QQ.JoinRequestList>;
    approveJoinRequest(group_openid: string, member_openid: string, data: QQ.ApprovalJoinRequestRequest): Promise<{}>;
    getRestrictChatSetting(group_openid: string): Promise<QQ.RestrictChatSetting>;
    setRestrictChatSetting(group_openid: string, data: QQ.SetRestrictChatSettingRequest): Promise<{}>;
    getJoinApprovalStrategyList(params?: Partial<{
      cursor: string;
      limit: number;
    }>): Promise<QQ.JoinApprovalStrategyList>;
    createJoinApprovalStrategy(data: QQ.CreateJoinApprovalStrategyRequest): Promise<QQ.CreateJoinApprovalStrategyResponse>;
    modifyJoinApprovalStrategy(strategy_id: string, data: QQ.ModifyJoinApprovalStrategyRequest): Promise<QQ.ModifyJoinApprovalStrategyResponse>;
    deleteJoinApprovalStrategy(strategy_id: string): Promise<{}>;
    executeJoinApprovalStrategy(strategy_id: string): Promise<{}>;
    modifyJoinApprovalStrategyWhitelist(strategy_id: string, data: QQ.ModifyJoinApprovalStrategyWhitelistRequest): Promise<QQ.ModifyJoinApprovalStrategyWhitelistResponse>;
  }
}

GroupInternal.define(false, {
  '/v2/groups/{channel.id}/messages': {
    POST: 'sendMessage',
  },
  '/v2/groups/{channel.id}/messages/{message.id}': {
    DELETE: 'deleteMessage',
  },
  '/v2/users/{user.id}/messages': {
    POST: 'sendPrivateMessage',
  },
  '/v2/users/{user.id}/messages/{message.id}': {
    DELETE: 'deletePrivateMessage',
  },
  '/v2/users/{user.id}/files': {
    POST: ['sendFilePrivate', 'completeUploadPrivate'],
  },
  '/v2/groups/{channel.id}/files': {
    POST: ['sendFileGuild', 'completeUploadGuild'],
  },
  '/v2/users/{user.id}/upload_prepare': {
    POST: 'uploadPreparePrivate',
  },
  '/v2/users/{user.id}/upload_part_finish': {
    POST: 'uploadPartFinishPrivate',
  },
  '/v2/groups/{channel.id}/upload_prepare': {
    POST: 'uploadPrepareGuild',
  },
  '/v2/groups/{channel.id}/upload_part_finish': {
    POST: 'uploadPartFinishGuild',
  },
  '/gateway': {
    GET: 'getGateway',
  },
  '/gateway/bot': {
    GET: 'getGatewayBot',
  },
  '/v2/groups/{group.openid}/info': {
    GET: 'getGroupInfo',
  },
  '/v2/groups/{group.openid}/bot_state': {
    GET: 'getBotGroupState',
  },
  '/v2/groups/{group.openid}/join_request_list': {
    GET: 'getJoinRequestList',
  },
  '/v2/groups/{group.openid}/approval_join_request/{member.openid}': {
    POST: 'approveJoinRequest',
  },
  '/v2/groups/{group.openid}/restrict_chat_setting': {
    GET: 'getRestrictChatSetting',
    POST: 'setRestrictChatSetting',
  },
  '/v2/groups/join_approval_strategy': {
    GET: 'getJoinApprovalStrategyList',
    POST: 'createJoinApprovalStrategy',
  },
  '/v2/groups/join_approval_strategy/{strategy.id}': {
    PATCH: 'modifyJoinApprovalStrategy',
    DELETE: 'deleteJoinApprovalStrategy',
  },
  '/v2/groups/join_approval_strategy/{strategy.id}/execute': {
    POST: 'executeJoinApprovalStrategy',
  },
  '/v2/groups/join_approval_strategy/{strategy.id}/whitelist_users': {
    POST: 'modifyJoinApprovalStrategyWhitelist',
  },
});

// fxxk tencent
GroupInternal.define(false, {
  '/interactions/{interaction.id}': {
    PUT: 'acknowledgeInteraction',
  },
}, { responseType: 'text' });

const originalGetJoinRequestList = GroupInternal.prototype.getJoinRequestList;

// 拉取申请列表时同步登记，保证后续可以直接用 join_request_id 调用通用审批接口
GroupInternal.prototype.getJoinRequestList = async function (this: GroupInternal, group_openid: string, params?: Partial<{
  cursor: string;
  limit: number;
}>)
{
  const result = await originalGetJoinRequestList.call(this, group_openid, params);
  const bot = this.getBot() as QQBot;
  for (const item of result.list ?? [])
  {
    bot.registerJoinRequest(group_openid, item.member_openid, item.join_request_id);
  }
  return result;
};
