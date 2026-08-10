# 配置说明

本页按当前源码中的 `src/config.ts` 说明插件配置项。

## 基础设置

### id

- 类型：`string`
- 必填：是
- 说明：QQ 机器人 `AppID`，注意不是 QQ 号
- 前往 <https://q.qq.com/qqbot/#/developer/developer-setting> 获取

### secret

- 类型：`string`
- 必填：是
- 说明：QQ 机器人 `AppSecret`
- 前往 <https://q.qq.com/qqbot/#/developer/developer-setting> 获取

### type

- 类型：`'public' | 'private'`
- 默认值：`private`
- 说明：机器人类型
- 前往 <https://q.qq.com/qqbot/#/developer/sandbox> 可查看机器人类型

### intents

- 类型：`bitset`
- 默认值：内置一组常用事件
- 说明：控制需要订阅哪些 QQ 事件

如果你不确定，建议直接使用默认值。

本次新增的群相关事件统一由 `GROUP_AND_C2C_EVENT` 意图位控制，包括：

- `GROUP_JOIN_REQUEST`
- `GROUP_MSG_RECEIVE`
- `GROUP_MSG_REJECT`

`GROUP_AND_C2C_EVENT` 的值为 `1 << 25`，已包含在默认配置中。

### retryWhen

- 类型：`number[]`
- 默认值：`[]`
- 说明：发送消息遇到这些平台错误码时自动重试一次

适合放一些你在实战里经常遇到、但重试有机会成功的错误码。

### protocol

- 类型：`'websocket' | 'webhook'`
- 默认值：`websocket`
- 说明：选择连接协议

## WebSocket 模式配置

当 `protocol = websocket` 时，会额外启用 WebSocket 客户端配置。

### gatewayUrl

- 类型：`string`
- 默认值：空
- 说明：覆盖 QQ 官方返回的 WebSocket 地址

适合你通过反代、中转或抓包环境接入时使用。

## Webhook 模式配置

当 `protocol = webhook` 时，会启用下面的配置项。

### path

- 类型：`string`
- 默认值：`/qq`
- 说明：QQ 官方回调到 Koishi 的 HTTPS 路径

例如你的 Koishi 对外地址是：

```text
https://bot.example.com
```

并且这里配置为：

```text
/qq
```

那么实际回调地址就是：

```text
https://bot.example.com/qq
```

需注意，webhook 接入必须要求有SSL证书，且校验时有延迟要求。

## 进阶设置

### sandbox

- 类型：`boolean`
- 默认值：`false`
- 说明：是否使用 QQ 沙箱地址

开启后，仅响应沙箱环境的调用。

> 不建议开启，这可能会导致你的提审不通过哦~

### endpoint

- 类型：`string`
- 默认值：`https://api.sgroup.qq.com/`
- 说明：覆盖 OpenAPI 根地址

适合反代、中转服务或调试环境。

### manualAcknowledge

- 类型：`boolean`
- 默认值：`false`
- 说明：是否手动响应互动回调

默认情况下，按钮互动等回调会自动 ACK。

如果你想自己控制 ACK 时机，再打开这个选项。

## 高级设置

### autoStreamText

- 类型：`boolean`
- 默认值：`false`
- 说明：是否把纯文本消息自动转成 QQ 原生 Markdown 流式首包

这个开关只会处理“纯文本消息”。

包含图片、音频、视频、按钮、复杂元素的消息仍然会走原本的发送逻辑。

注意：

- 这里的“自动流式”只会自动附加 `state = 1`
- 适配器**不会**自动帮你发送 `state = 10`
- 如果你要显式结束流式，需要自己传原始 `stream` 对象

### loggerinfo

- 类型：`boolean`
- 默认值：`false`
- 说明：调试模式
