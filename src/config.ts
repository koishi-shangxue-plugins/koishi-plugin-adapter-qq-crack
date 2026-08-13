import { Schema } from 'koishi';
import { WsClient } from './ws';
import * as QQ from './types';
import { HttpServer } from './http';

type IntentKey = keyof typeof QQ.Intents;

const defaultIntentKeys = [
  'GUILDS',
  'GUILD_MEMBER_ADD',
  'GUILD_MEMBER_REMOVE',
  'GUILD_MEMBERS',
  'GUILD_MESSAGE_REACTIONS',
  'DIRECT_MESSAGES',
  'OPEN_FORUMS_EVENT',
  'AUDIO_OR_LIVE_CHANNEL_MEMBER',
  'GROUP_AND_C2C_EVENT',
  'INTERACTIONS',
  'MESSAGE_AUDIT',
  'AUDIO_ACTION',
  'PUBLIC_GUILD_MESSAGES',
] as const satisfies readonly IntentKey[];

const defaultIntents = defaultIntentKeys.reduce((value, intent) => value | QQ.Intents[intent], 0);

export interface BaseConfig extends QQ.Options
{
  intents?: number;
  retryWhen: number[];
  manualAcknowledge: boolean;
  loggerinfo: boolean;
  autoStreamText: boolean;
  useMarkdownIfAt: boolean;
  disableUserNamePersist: boolean;
  userInfoApi?: string;
  protocol: 'websocket' | 'webhook';
  path?: string;
  gatewayUrl?: string;
  privateMenuOverride?: boolean;
  privateMenu?: QQ.MenuItemConfig[];
  groupPanelsOverride?: boolean;
  groupPanels?: QQ.PanelItemConfig[];
}

export type Config = BaseConfig & (HttpServer.Options | WsClient.Options);

function privateMenuItemSchema()
{
  const name = Schema.string().description('按钮名称，最多 10 个字符，一个中文汉字按 2 个字符计算。').required();
  return Schema.intersect([
    Schema.object({
      name,
      type: Schema.union([
        Schema.const('send_message').description('发送'),
        Schema.const('link').description('链接'),
        Schema.const('menu').description('菜单'),
        Schema.const('switch').description('开关'),
      ]).description('按钮类型。').default('send_message'),
    }),
    Schema.union([
      Schema.object({
        type: Schema.const('send_message'),
        value: Schema.string().description('用户点击后自动填入聊天输入框的内容。').default(''),
      }),
      Schema.object({
        type: Schema.const('link').required(),
        value: Schema.string().role('link').description('跳转链接，必须以 https:// 开头。').default(''),
      }),
      Schema.object({
        type: Schema.const('switch').required(),
        value: Schema.string().description('开关唯一标识。').default(''),
        switchDefault: Schema.boolean().description('默认是否打开。').default(false),
      }),
      Schema.object({
        type: Schema.const('menu').required(),
        subMenuItems: Schema.array(Schema.object({
          name: Schema.string().description('子按钮名称。').required(),
          type: Schema.union([
            Schema.const('send_message').description('发送'),
            Schema.const('link').description('链接'),
          ]).description('子按钮类型。').default('send_message'),
          value: Schema.string().description('发送内容或跳转链接。').default(''),
        })).max(5).role('table').default([]).description('子菜单项。'),
      }),
    ]),
  ]);
}

function groupPanelItemSchema()
{
  const name = Schema.string().description('指令文本，最多 14 个字符，约 7 个中文汉字。').required();
  const description = Schema.string().description('指令描述，最多 30 个字符，约 15 个中文汉字。').default('');
  const onlyAdmin = Schema.boolean().description('是否仅群管理员可点击。').default(false);
  return Schema.intersect([
    Schema.object({
      name,
      description,
      type: Schema.union([
        Schema.const('command').description('指令'),
        Schema.const('link').description('链接'),
      ]).description('面板元素类型。').default('command'),
    }),
    Schema.union([
      Schema.object({
        type: Schema.const('command'),
        onlyAdmin,
      }),
      Schema.object({
        type: Schema.const('link').required(),
        value: Schema.string().role('link').description('跳转链接，必须以 https:// 开头。').default(''),
        onlyAdmin,
      }),
    ]),
  ]);
}

export const Config: Schema<Config> = Schema.intersect([
  Schema.object({
    id: Schema.string().description('机器人ID（AppID）。').required(),
    secret: Schema.string().description('机器人密钥（secret）。').role('secret'),
    type: Schema.union(['public', 'private'] as const).description('机器人类型。').default('private'),
    intents: Schema.bitset(QQ.Intents).description('需要订阅的机器人事件。').default(defaultIntents),
    retryWhen: Schema.array(Number).description('发送消息遇到平台错误码时重试。').default([]),
    protocol: Schema.union(['websocket', 'webhook']).description('选择要使用的协议。').default('websocket'),
  }),
  Schema.union([
    Schema.intersect([
      Schema.object({
        protocol: Schema.const('websocket').required(false),
      }),
      WsClient.Options,
      Schema.object({}),
    ]),
    Schema.intersect([
      Schema.object({
        protocol: Schema.const('webhook').required(false),
      }),
      HttpServer.Options,
      Schema.object({}),
    ]),
  ]),
  Schema.object({
    sandbox: Schema.boolean().description('是否开启沙箱模式。').default(false),
    endpoint: Schema.string().role('link').description('要连接的服务器地址。').default('https://api.bot.qq.com/'),
    manualAcknowledge: Schema.boolean().description('手动响应回调消息。').default(false),
    gatewayUrl: Schema.string().role('link').description('覆盖 WebSocket 地址。'),
    userInfoApi: Schema.string().role("link").default("https://oiapi.net/api/Openid").description("API 接口地址"),
  }).description('进阶设置'),
  Schema.object({
    privateMenuOverride: Schema.boolean().default(false).description('是否覆盖并删除冗余的单聊菜单。关闭时仅向原有菜单追加配置项。'),
    privateMenu: Schema.array(privateMenuItemSchema()).max(10).default([]).description('单聊自定义菜单。'),
  }).description('私聊指令菜单'),
  Schema.object({
    groupPanelsOverride: Schema.boolean().default(false).description('是否覆盖并删除冗余的群聊指令面板。关闭时仅向原有面板追加配置项。'),
    groupPanels: Schema.array(groupPanelItemSchema()).max(20).default([]).description('群聊指令面板。'),
  }).description('群聊指令菜单'),
  Schema.object({
    autoStreamText: Schema.boolean().description('使用原生 Markdown 流式发送纯文本消息。').default(false),
    useMarkdownIfAt: Schema.boolean().description('在包含 `<at>` 元素时使用 Markdown 格式，禁用将忽略 `<at>` 元素。').default(true),
    loggerinfo: Schema.boolean().default(false).description('调试模式').experimental(),
    disableUserNamePersist: Schema.boolean().default(false).description('禁用将消息中的用户名写入数据库（调试用）。').experimental(),
  }).description('高级设置'),
] as const);
