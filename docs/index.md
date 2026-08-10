# koishi-plugin-adapter-qq-crack

|                                                                 NPM Version                                                                 |                                                                   Downloads                                                                    |                                           Platform                                           |                                                                                                 License                                                                                                 |
| :-----------------------------------------------------------------------------------------------------------------------------------------: | :--------------------------------------------------------------------------------------------------------------------------------------------: | :------------------------------------------------------------------------------------------: | :-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------: |
| [![npm version](https://img.shields.io/npm/v/koishi-plugin-adapter-qq-crack)](https://www.npmjs.com/package/koishi-plugin-adapter-qq-crack) | [![npm downloads](https://img.shields.io/npm/dt/koishi-plugin-adapter-qq-crack)](https://www.npmjs.com/package/koishi-plugin-adapter-qq-crack) | [![platform](https://img.shields.io/badge/platform-Koishi-blueviolet)](https://koishi.chat/) | [![license](https://img.shields.io/github/license/koishi-shangxue-plugins/koishi-plugin-adapter-qq-crack)](https://github.com/koishi-shangxue-plugins/koishi-plugin-adapter-qq-crack/blob/main/LICENSE) |

`koishi-plugin-adapter-qq-crack` 是 Koishi 的 QQ 官方机器人适配器。

基于官方 `adapter-qq` 的思路继续维护，但已经改成了更适合 Koishi 项目的插件结构，并补充了 QQ 近期开出来的一些能力。

## 当前文档覆盖的内容

- QQ 官方机器人接入方式
- WebSocket / Webhook 两种协议
- AccessToken 鉴权
- 群聊、私聊、频道场景的 `channelId` 约定
- 原生 Markdown、模板 Markdown、按钮模板 JSON 的消息发送方式
- 纯文本自动流式开关与 `stream` 的两种写法
- 群组基础信息、机器人群内状态、群成员禁言
- 入群申请事件与审批、入群自动审批策略
- 群消息接收开启/关闭事件

## 当前适配器的重点特性

- 仅使用 QQ 官方当前推荐的 AccessToken 鉴权，不再保留旧固定 Token 模式
- 支持 `qq:json`、`qq:markdown`、`qq:rawmarkdown`、`qq:rawmarkdown-without-keyboard`
- 兼容 `h('markdown', ...)` 直接走 QQ 原生 Markdown
- 支持 `private:${userId}` 私聊频道 ID 方案
- 支持将 WebSocket 消息中的用户名写回 Koishi 数据库并回填到 `session.username`
- 心跳僵死时会立即重连，尽量缩短断开时间
- 支持 `bot.refreshBotGroupState()` 手动刷新机器人群内角色
- 支持 `guild-member-request`、`group-msg-receive`、`group-msg-reject` 事件

## 仓库与反馈

- GitHub 仓库：[koishi-plugin-adapter-qq-crack](https://github.com/koishi-shangxue-plugins/koishi-plugin-adapter-qq-crack)
- 问题反馈：[Issues](https://github.com/koishi-shangxue-plugins/koishi-plugin-adapter-qq-crack/issues)
