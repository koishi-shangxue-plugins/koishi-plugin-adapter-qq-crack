# 通用 API

本页只介绍部分常用调用方式，重点说明当前适配器扩展的 `qq:*` 元素。

## `markdown`

`markdown` 在本适配器里默认等价于 `qq:rawmarkdown-without-keyboard`。

### 最简单写法

```ts
await session.send(h('markdown', '# 你好\n## 这是 Markdown'))
```

### 对象写法

```ts
await session.send(h('markdown', {
  content: '# 你好\n## 这是 Markdown',
}))
```

### 流式首包写法

```ts
await session.send(h('markdown', {
  content: '# 你好\n## 这是 Markdown',
  stream: true,
}))
```

这里的 `stream: true` 是适配器内部的快捷写法，表示自动附加：

```ts
stream: {
  state: 1,
  reset: false,
}
```

注意：

- 这里只会自动进入流式状态
- 不会自动发送 `state = 10`

## `qq:rawmarkdown-without-keyboard`

这个元素和 `markdown` 的行为一致，只是名称更显式。

```ts
await session.send(h('qq:rawmarkdown-without-keyboard', '# 你好\n这是原生 Markdown'))
```

也支持对象写法：

```ts
await session.send(h('qq:rawmarkdown-without-keyboard', {
  content: '# 你好\n这是原生 Markdown',
  stream: true,
}))
```

## `qq:rawmarkdown`

用于发送原生 Markdown，同时允许你自己携带 `keyboard`。

```ts
await session.send(h('qq:rawmarkdown', {
  markdown: {
    content: '# 标题\n这是正文',
  },
  keyboard: {
    content: {
      rows: [
        {
          buttons: [
            {
              render_data: {
                label: '再来一次',
                style: 1,
              },
              action: {
                type: 2,
                permission: { type: 2 },
                data: '重新执行',
                enter: true,
              },
            },
          ],
        },
      ],
    },
  },
}))
```

如果你只是想传文本内容，也可以写成：

```ts
await session.send(h('qq:rawmarkdown', {
  content: '# 标题\n这是正文',
  stream: true,
}))
```

## `qq:markdown`

推荐用于“模板 Markdown”消息，也就是你已经在 QQ 官方后台申请好了 Markdown 模板 ID。

### 模板写法

```ts
await session.send(h('qq:markdown', {
  markdown: {
    custom_template_id: '你的模板ID',
    params: [
      { key: 'text1', values: ['第一个参数'] },
      { key: 'text2', values: ['第二个参数'] },
    ],
  },
  keyboard: {
    id: '你的按钮模板ID',
  },
}))
```

### 兼容快捷写法

如果你直接传字符串或 `content`，当前适配器也会把它当成原生 Markdown 内容处理。

```ts
await session.send(h('qq:markdown', '# 你好\n## 这是 Markdown'))
```

```ts
await session.send(h('qq:markdown', {
  content: '# 你好\n## 这是 Markdown',
  stream: true,
}))
```

但如果你明确在发模板消息，还是建议使用完整对象写法。

## `qq:json`

这个元素主要用于发送 QQ 按钮模板 JSON。

### 直接传模板 ID

```ts
await session.send(h('qq:json', '123456789'))
```

### 对象写法

```ts
await session.send(h('qq:json', {
  keyboard: {
    id: '123456789',
  },
}))
```

也兼容：

```ts
await session.send(h('qq:json', {
  id: '123456789',
}))
```

## `qq:ark24`

用于发送 QQ 官方 ARK 24 模板，也就是文本 + 缩略图模板。

```ts
await session.send(h('qq:ark24', {
  desc: '描述文本',
  prompt: '提示文本',
  title: '标题',
  metaDesc: '详情描述',
  img: 'https://example.com/cover.jpg',
  link: 'https://example.com',
  subTitle: '来源',
}))
```

如果你要包装 `mqqapi://` 地址，也可以这样写：

```ts
await session.send(h('qq:ark24', {
  desc: '半屏打开网页',
  prompt: '点击打开',
  title: '半屏网页测试',
  metaDesc: '通过 ARK24 打开半屏网页',
  img: 'https://example.com/cover.jpg',
  link: 'mqqapi://openhalfscreenweb/?height=1920&url=https%3A%2F%2Fexample.com',
  subTitle: 'adapter-qq-crack',
}))
```

字段说明：

- `desc`：描述文本
- `prompt`：提示文本
- `title`：标题
- `metaDesc`：详情描述
- `img`：缩略图链接
- `link`：点击后的跳转链接
- `subTitle`：来源文本

## `qq:ark23`

用于发送 QQ 官方 ARK 23 模板，也就是链接 + 文本列表模板。

```ts
await session.send(h('qq:ark23', {
  desc: '任务状态',
  prompt: '状态通知',
  list: [
    { desc: '需求标题：UI 问题解决' },
    { desc: '当前状态：体验中' },
    { desc: '已评审', link: 'https://example.com/review' },
    { desc: '开发中', link: 'https://example.com/dev' },
  ],
}))
```

字段说明：

- `desc`：描述文本
- `prompt`：提示文本
- `list`：列表数组
- `list[].desc`：列表文字
- `list[].link`：可选，存在时显示为链接

## `qq:ark37`

用于发送 QQ 官方 ARK 37 模板，也就是大图模板。

```ts
await session.send(h('qq:ark37', {
  prompt: '通知提醒',
  metaTitle: '标题',
  metaSubTitle: '子标题',
  metaCover: 'https://example.com/cover.jpg',
  metaUrl: 'https://example.com',
}))
```

字段说明：

- `prompt`：提示文本
- `metaTitle`：标题
- `metaSubTitle`：子标题
- `metaCover`：大图链接
- `metaUrl`：跳转链接

## `qq:ark`

如果上面三个封装模板不够用，也可以直接传原始 `ark` 结构。

```ts
await session.send(h('qq:ark', {
  template_id: 24,
  kv: [
    { key: '#DESC#', value: '描述文本' },
    { key: '#PROMPT#', value: '提示文本' },
    { key: '#TITLE#', value: '标题' },
    { key: '#METADESC#', value: '详情描述' },
    { key: '#IMG#', value: 'https://example.com/cover.jpg' },
    { key: '#LINK#', value: 'https://example.com' },
    { key: '#SUBTITLE#', value: '来源' },
  ],
}))
```

如果你的数据本身就是完整的 `ark` 对象，也可以这样传：

```ts
await session.send(h('qq:ark', {
  ark: {
    template_id: 37,
    kv: [
      { key: '#PROMPT#', value: '通知提醒' },
      { key: '#METATITLE#', value: '标题' },
      { key: '#METASUBTITLE#', value: '子标题' },
      { key: '#METACOVER#', value: 'https://example.com/cover.jpg' },
      { key: '#METAURL#', value: 'https://example.com' },
    ],
  },
}))
```

## `stream` 的两种写法

当前推荐统一写成 `stream`。

### `stream: true`

这是适配器内部的布尔快捷开关：

```ts
await session.send(h('markdown', {
  content: '正在生成中',
  stream: true,
}))
```

作用：

- 自动附加 `state = 1`
- 方便快速进入流式状态

### `stream: { ... }`

这是 QQ 官方原始流式对象：

```ts
await session.send(h('markdown', {
  content: '完整消息',
  stream: {
    state: 10,
    id: streamId,
    index: 1,
    reset: true,
  },
}))
```

如果你自己显式传了对象形式的 `stream`，它的优先级更高。

## 自动纯文本流式

如果你在插件配置里打开：

```json
{
  "autoStreamText": true
}
```

那么纯文本消息会自动改成 QQ 原生 Markdown 流式首包发送。

生效条件大致是：

- 纯文本
- 没有附件
- 没有按钮
- 没有复杂富媒体元素

## 注意事项

### 1. 原生 Markdown 是 QQ 客户端自己的渲染

不同客户端对同一条 Markdown 的表现可能不同，尤其是：

- Windows QQ
- 手机 QQ

### 2. 蓝字按钮本质是 Markdown 链接

例如：

```md
[蓝字按钮](mqqapi://aio/inlinecmd?command=帮助&enter=false&reply=false)
```

### 3. 自动流式不会自动结束

如果你用了 `stream: true`，适配器只会帮你发首包。结束流式这一步仍然需要你自己决定时机，并显式发送 `state = 10`。

## 群组信息

### `bot.getGuild(guildId)`

获取群基础信息，返回 `Universal.Guild`。这里的 `guildId` 就是群事件里的 `group_openid`，也是 `session.guildId`。

```ts
const guild = await bot.getGuild(session.guildId)
console.log(guild.name)
```

### `bot.getChannel(channelId)`

获取频道信息，返回 `Universal.Channel`。QQ 群的 `channelId` 与 `guildId` 相同；私聊频道会识别 `private:userId` 格式并转去调用 `getUser`。

```ts
const channel = await bot.getChannel(session.channelId)
console.log(channel.name, channel.type)
```

### `bot.getChannelList(guildId)`

群场景下返回当前群对应的频道信息。

```ts
const { data } = await bot.getChannelList(session.guildId)
```

## 机器人群内状态

### `bot.refreshBotGroupState(guildId)`

手动请求 QQ 的 `bot_state` 接口，并把 `member_role` 写入 `bot.user.role`，最后返回完整状态对象。

适配器不会自动调用这个接口，调用时机和频率由插件自行控制。

```ts
const state = await bot.refreshBotGroupState(session.guildId)
console.log(state.member_role)
console.log(bot.user.role)
```

接口频率限制为 30 QPM。

## 群成员禁言

### `bot.muteGuildMember(guildId, userId, duration, reason?)`

禁言时间单位是毫秒，传入 `0` 表示解除禁言。该能力要求机器人具有群管理员权限。

```ts
// 禁言 30 秒
await bot.muteGuildMember(session.guildId, session.userId, 30_000)

// 解除禁言
await bot.muteGuildMember(session.guildId, session.userId, 0)
```

### 内部查询与设置

```ts
// 查询当前群禁言状态
const setting = await bot.internal.getRestrictChatSetting(groupOpenid)

// 直接设置成员禁言
await bot.internal.setRestrictChatSetting(groupOpenid, {
  members: [{
    op: 'add',
    member_openid: userId,
    mute_expire_at: new Date(Date.now() + 30_000).toISOString(),
  }],
})
```

`op` 支持：

- `add`：增加禁言
- `update`：更新禁言到期时间
- `del`：解除禁言

## 入群申请

### 监听入群申请

`GROUP_JOIN_REQUEST` 会被适配成 Koishi 事件 `guild-member-request`。

```ts
ctx.on('guild-member-request', async (session) => {
  console.log(session.guildId)
  console.log(session.userId)
  console.log(session.messageId)
})
```

事件字段对应关系：

- `session.guildId`：`group_openid`
- `session.userId`：`member_openid`
- `session.messageId`：`join_request_id`
- `session.content`：验证信息文本

### 自动同意

```ts
ctx.on('guild-member-request', async (session) => {
  await session.bot.handleGuildMemberRequest(session.messageId, true)
})
```

### 拒绝申请

```ts
await session.bot.handleGuildMemberRequest(session.messageId, false, '拒绝原因')
```

### 获取入群申请列表

```ts
const { list, next_cursor } = await bot.internal.getJoinRequestList(groupOpenid, {
  cursor: '',
  limit: 20,
})
```

### 直接审批

```ts
// 同意
await bot.internal.approveJoinRequest(groupOpenid, memberOpenid, {
  op: 'approve',
  join_request_id,
})

// 拒绝并拉黑
await bot.internal.approveJoinRequest(groupOpenid, memberOpenid, {
  op: 'decline',
  join_request_id,
  reject_reason: '不符合入群要求',
  add_to_member_blacklist: true,
})
```

## 群消息接收事件

QQ 平台会下发：

- `GROUP_MSG_RECEIVE`
- `GROUP_MSG_REJECT`

适配器对应事件：

- `group-msg-receive`
- `group-msg-reject`

同时保留原始内部事件：

- `qq/group-msg-receive`
- `qq/group-msg-reject`

```ts
ctx.on('group-msg-receive', (session) => {
  console.log('群消息接收已开启', session.guildId)
})

ctx.on('group-msg-reject', (session) => {
  console.log('群消息接收已关闭', session.guildId)
})
```

这些事件通过 `GROUP_AND_C2C_EVENT` 意图位订阅，默认已开启。

## 入群自动审批策略

### 查询策略列表

```ts
const { strategies, next_cursor } = await bot.internal.getJoinApprovalStrategyList({
  cursor: '',
  limit: 20,
})
```

### 创建策略

```ts
await bot.internal.createJoinApprovalStrategy({
  group_openids: [groupOpenid],
  is_enable: 'on',
  expire_at: '',
})
```

也可以使用 QQ 群号：

```ts
await bot.internal.createJoinApprovalStrategy({
  group_ids: ['123456789'],
})
```

### 修改策略

```ts
// 关闭策略
await bot.internal.modifyJoinApprovalStrategy(strategyId, {
  is_enable: 'off',
})

// 新增关联群
await bot.internal.modifyJoinApprovalStrategy(strategyId, {
  group_action: {
    op: 'add',
    group_openids: [groupOpenid],
  },
})
```

### 删除策略

```ts
await bot.internal.deleteJoinApprovalStrategy(strategyId)
```

### 执行策略

对策略关联的全部群发起全量扫描，自动审批命中白名单的入群申请。

```ts
await bot.internal.executeJoinApprovalStrategy(strategyId)
```

### 修改白名单

```ts
await bot.internal.modifyJoinApprovalStrategyWhitelist(strategyId, {
  op: 'add',
  whitelist_users: ['1234567', '1234568'],
})
```

`op` 支持 `add` 和 `del`。
