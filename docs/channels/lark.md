---
summary: "飞书/Lark 机器人支持状态、功能和配置"
read_when:
  - 开发飞书/Lark 渠道功能
  - 设置飞书机器人集成
---
# 飞书 / Lark (插件)

飞书 (Lark) 是字节跳动推出的企业协作平台。Moltbot 通过官方 Bot API 以**机器人**身份连接，
支持私聊和群聊。机器人默认使用 WebSocket 长连接模式，无需公网 URL。

状态：通过插件支持 (@larksuiteoapi/node-sdk)。支持私聊、群聊、媒体、表情回应和卡片消息。

## 需要安装插件

飞书作为插件提供，不包含在核心安装中。

通过 CLI 安装 (npm 仓库)：

```bash
moltbot plugins install @moltbot/lark
```

本地安装 (从 git 仓库运行时)：

```bash
moltbot plugins install ./extensions/lark
```

如果在配置/引导过程中选择飞书，且检测到 git 仓库，
Moltbot 会自动提供本地安装路径选项。

详情：[插件](/plugin)

## 快速开始

1) 在[飞书开放平台](https://open.feishu.cn/app)创建机器人（国际版使用 [Larksuite](https://open.larksuite.com/app)）。
2) 复制 **App ID** 和 **App Secret**。
3) 启用所需权限和 WebSocket 模式。
4) 为 Moltbot 设置凭证并启动网关。

最小配置：

```json5
{
  channels: {
    lark: {
      enabled: true,
      appId: "cli_xxxxxxxxxxxx",
      appSecret: "xxxxxxxxxxxxxxxxxxxx",
      dmPolicy: "pairing"
    }
  }
}
```

## 详细设置

### 1) 创建飞书机器人

1) 访问[飞书开放平台](https://open.feishu.cn/app)（国内）或 [Larksuite 开放平台](https://open.larksuite.com/app)（国际）。
2) 点击**创建企业自建应用**，填写基本信息（名称、描述、图标）。
3) 在**凭证与基础信息**中，复制 **App ID** (`cli_...`) 和 **App Secret**。

### 2) 配置权限

在**权限管理**中添加以下权限：

**必需权限：**
- `im:message` - 发送消息
- `im:message:send_as_bot` - 以机器人身份发送消息
- `im:message.receive_v1` - 接收消息（事件订阅）
- `im:chat:readonly` - 读取会话信息

**可选权限（媒体功能）：**
- `im:resource` - 上传/下载图片和文件

添加权限后，点击**申请开通**（部分权限需要管理员审批）。

### 3) 启用 WebSocket 模式

在**事件配置**中：
1) 启用**使用长连接接收事件**（WebSocket 模式）。
2) 添加事件订阅：`im.message.receive_v1`（接收消息）。

推荐使用 WebSocket 模式，因为：
- 无需公网 URL 或 Webhook 配置
- 可在 NAT/防火墙后运行
- 延迟比 HTTP 轮询更低

### 4) 配置 Moltbot

通过环境变量设置凭证（推荐）：
- `LARK_APP_ID=cli_xxxxxxxxxxxx`
- `LARK_APP_SECRET=xxxxxxxxxxxxxxxxxxxx`

或通过配置文件：

```json5
{
  channels: {
    lark: {
      enabled: true,
      appId: "cli_xxxxxxxxxxxx",
      appSecret: "xxxxxxxxxxxxxxxxxxxx",
      dmPolicy: "pairing"
    }
  }
}
```

如果同时设置了环境变量和配置文件，配置文件优先。

### 5) 发布机器人

在开放平台中，进入**版本管理与发布**，发布机器人。
发布后用户可以在飞书中找到并与机器人对话。

### 6) 启动网关

```bash
moltbot gateway run
```

私聊访问默认为配对模式，首次联系机器人时需要批准配对码。

## 路由模型

- 回复始终发回飞书。
- 私聊共享 agent 的主会话；群聊映射到 `agent:<agentId>:lark:group:<chatId>` 会话。

## 访问控制（私聊）

- 默认：`channels.lark.dmPolicy = "pairing"`。未知发送者会收到配对码（1 小时后过期）。
- 批准方式：
  - `moltbot pairing list lark`
  - `moltbot pairing approve lark <CODE>`
- 公开私聊：设置 `channels.lark.dmPolicy="open"` 和 `channels.lark.allowFrom=["*"]`。
- `channels.lark.allowFrom` 接受用户 ID (`ou_...`) 或邮箱地址。

### 查找用户 ID

1) 启动网关，让用户私聊你的机器人。
2) 运行 `moltbot logs --follow`，在消息负载中查找 `open_id` 或 `user_id`。

或使用飞书管理后台查找用户 ID。

## 群组

- 默认：`channels.lark.groupPolicy = "allowlist"`（需要 @提及）。使用 `channels.defaults.groupPolicy` 可覆盖默认值。
- 通过 `channels.lark.groups` 配置群组白名单（会话 ID）：

```json5
{
  channels: {
    lark: {
      groupPolicy: "allowlist",
      groups: {
        "oc_xxxxxxxxxxxxxxxx": { allow: true, requireMention: true }
      },
      groupAllowFrom: ["ou_owner_id"]
    }
  }
}
```

- `requireMention: false` 启用该群组的自动回复。
- `groups."*"` 可为所有群组设置 @提及默认值。
- `groupAllowFrom` 限制哪些发送者可以在群组中触发机器人（可选）。
- 要禁止所有群组，设置 `channels.lark.groupPolicy: "disabled"`（或保持空白名单）。

### 查找群聊 ID

1) 将机器人添加到群组并发送一条消息。
2) 运行 `moltbot logs --follow`，在消息负载中查找 `chat_id` (`oc_...`)。

或使用飞书 API 获取已加入的会话列表。

## @提及

在群组中，机器人在以下情况下响应：
- 被直接 @提及 (`@机器人名称`)
- 群组设置了 `requireMention: false`
- 消息匹配 `agents.list[].groupChat.mentionPatterns`

## 卡片消息

飞书支持富文本卡片消息，可以包含标题、内容、按钮等交互元素。

### 发送卡片消息

Agent 可以通过消息工具发送卡片：

```json5
{
  "action": "send",
  "channel": "lark",
  "to": "ou_xxxx",
  "card": {
    "header": {
      "title": {
        "tag": "plain_text",
        "content": "任务通知"
      },
      "template": "blue"
    },
    "elements": [
      {
        "tag": "div",
        "text": {
          "tag": "lark_md",
          "content": "您有一个新任务需要处理。\n\n**任务名称**：代码审查\n**截止时间**：2026-01-30"
        }
      },
      {
        "tag": "action",
        "actions": [
          {
            "tag": "button",
            "text": {
              "tag": "plain_text",
              "content": "查看详情"
            },
            "type": "primary",
            "value": { "action": "view_detail" }
          },
          {
            "tag": "button",
            "text": {
              "tag": "plain_text",
              "content": "稍后处理"
            },
            "type": "default",
            "value": { "action": "defer" }
          }
        ]
      }
    ]
  }
}
```

### 卡片模板颜色

`header.template` 支持以下颜色：
- `blue` - 蓝色（默认）
- `wathet` - 浅蓝色
- `turquoise` - 青绿色
- `green` - 绿色
- `yellow` - 黄色
- `orange` - 橙色
- `red` - 红色
- `carmine` - 洋红色
- `violet` - 紫色
- `purple` - 深紫色
- `indigo` - 靛蓝色
- `grey` - 灰色

### 卡片元素类型

| 元素 | 说明 |
|------|------|
| `div` | 文本块，支持 `plain_text` 和 `lark_md` |
| `hr` | 分割线 |
| `img` | 图片 |
| `action` | 按钮组 |
| `note` | 备注信息 |
| `column_set` | 多列布局 |

### 按钮回调

当用户点击卡片按钮时，回调数据会作为消息发送给 agent：
`card_action: {"action": "view_detail"}`

### 配置选项

```json5
{
  channels: {
    lark: {
      capabilities: {
        cards: "allowlist"  // off | dm | group | all | allowlist
      }
    }
  }
}
```

作用域：
- `off` - 禁用卡片消息
- `dm` - 仅私聊可用
- `group` - 仅群聊可用
- `all` - 私聊和群聊都可用
- `allowlist` - 私聊和群聊都可用，但仅限 `allowFrom`/`groupAllowFrom` 中的发送者（默认）

## 功能支持

| 功能 | 状态 |
|------|------|
| 私聊 | 支持 |
| 群聊 | 支持 |
| 话题/线程 | 不支持（飞书线程功能有限） |
| 媒体（图片） | 支持 |
| 表情回应 | 支持 |
| 卡片消息 | 支持 |
| 原生命令 | 支持 |

## 限制

- 出站文本按 `channels.lark.textChunkLimit` 分块（默认 4000 字符）。
- 媒体上传遵循飞书的文件大小限制。

## 多账户

使用 `channels.lark.accounts` 配置多个账户凭证：

```json5
{
  channels: {
    lark: {
      accounts: {
        work: {
          appId: "cli_work_app",
          appSecret: "secret_work",
          dmPolicy: "pairing"
        },
        personal: {
          appId: "cli_personal_app",
          appSecret: "secret_personal",
          dmPolicy: "allowlist",
          allowFrom: ["ou_trusted_user"]
        }
      }
    }
  }
}
```

详见 [gateway/configuration](/gateway/configuration#telegramaccounts--discordaccounts--slackaccounts--signalaccounts--imessageaccounts) 中的共享模式。

## 故障排查

**机器人不响应：**
- 检查机器人是否已在开放平台发布和激活。
- 验证权限是否已批准（`im:message`、`im:message.receive_v1`）。
- 确保事件配置中已启用 WebSocket 模式。
- 查看 `moltbot logs --follow` 中的错误。

**权限拒绝错误 (99991403)：**
- 机器人缺少必需权限。
- 在开放平台启用 `im:message` 和 `im:message.receive_v1`。
- 如需要，申请管理员审批。

**连接错误：**
- 检查到飞书 API 端点的网络连接。
- 如果使用代理，确保 `*.feishu.cn` 和 `*.larksuite.com` 在 `NO_PROXY` 中。
- 飞书域名：`open.feishu.cn`、`open.larksuite.com`

**机器人看不到群消息：**
- 机器人必须被添加到群组。
- 如果设置了 `channels.lark.groups`，群组必须在列表中。
- 检查 `requireMention` 是否阻止了非 @提及消息。

**网关 CPU 使用率高：**
- 确保运行的是包含 WebSocket 修复的最新版本。
- 在 `moltbot logs --follow` 中检查重连循环。

更多帮助：[渠道故障排查](/channels/troubleshooting)

## 配置参考（飞书）

完整配置：[Configuration](/gateway/configuration)

提供者选项：

- `channels.lark.enabled`：启用/禁用渠道启动。
- `channels.lark.appId`：飞书 App ID (`cli_...`)。
- `channels.lark.appSecret`：飞书 App Secret。
- `channels.lark.dmPolicy`：`pairing | allowlist | open | disabled`（默认：pairing）。
- `channels.lark.allowFrom`：私聊白名单（用户 ID 或邮箱）。`open` 策略需要 `"*"`。
- `channels.lark.groupPolicy`：`allowlist | open | disabled`（默认：allowlist）。
- `channels.lark.groupAllowFrom`：群消息允许的发送者白名单。
- `channels.lark.groups`：群组白名单 + 每群设置映射。
  - `channels.lark.groups.<id>.allow`：允许/拒绝该群组。
  - `channels.lark.groups.<id>.requireMention`：该群组的 @提及要求。
  - `channels.lark.groups.<id>.skills`：技能过滤（省略 = 所有技能，空 = 无）。
  - `channels.lark.groups.<id>.systemPrompt`：该群组的额外系统提示。
  - `channels.lark.groups.<id>.enabled`：设为 `false` 禁用该群组。
- `channels.lark.textChunkLimit`：出站文本分块大小（字符，默认 4000）。
- `channels.lark.chunkMode`：`length`（默认）或 `newline` 按段落分块。
- `channels.lark.mediaMaxMb`：入站/出站媒体大小上限（MB）。
- `channels.lark.capabilities.cards`：卡片消息作用域（`off | dm | group | all | allowlist`）。
- `channels.lark.actions`：每个操作的工具权限控制（reactions/messages）。

环境变量：
- `LARK_APP_ID`：App ID（仅默认账户）。
- `LARK_APP_SECRET`：App Secret（仅默认账户）。
