---
summary: "Gateway 配对机制详解（中文）"
read_when:
  - 从容器或远程访问 Control UI 遇到配对问题
  - 需要理解 Gateway 的两层认证机制
  - 配置 Docker 环境下的 Gateway 访问
---
# Gateway 配对机制详解

## 概述

Moltbot Gateway 采用**两层认证机制**来保护 Control UI 和 WebSocket 连接：

| 层级 | 名称 | 作用 | 验证内容 |
|------|------|------|---------|
| 第一层 | Gateway Auth | 共享密钥认证 | token 或 password |
| 第二层 | Device Pairing | 设备身份认证 | 设备公钥 + 签名 |

只有两层都通过，客户端才能成功连接到 Gateway。

## 认证流程图

```
浏览器/客户端 访问 Control UI
         │
         ▼
┌─────────────────────────┐
│   1. Gateway Auth       │
│   (token/password)      │
│   验证共享密钥           │
└───────────┬─────────────┘
            │ 通过
            ▼
┌─────────────────────────┐
│   2. Device Pairing     │
│   (设备身份验证)         │
│   验证设备公钥+签名      │
└───────────┬─────────────┘
            │
     ┌──────┴──────┐
     ▼             ▼
  本地连接       远程连接
  (自动批准)    (需手动批准)
            或
  allowInsecureAuth=true
     (跳过设备验证)
```

## 第一层：Gateway Auth

### 认证方式

Gateway 支持三种认证方式：

1. **Token 认证**（推荐）
   ```json5
   {
     gateway: {
       auth: {
         mode: "token",
         token: "your-secure-random-token"
       }
     }
   }
   ```

2. **Password 认证**
   ```json5
   {
     gateway: {
       auth: {
         mode: "password",
         password: "your-password"
       }
     }
   }
   ```

3. **Tailscale 身份认证**
   ```json5
   {
     gateway: {
       auth: {
         allowTailscale: true
       }
     }
   }
   ```

### WebSocket 握手

客户端连接时发送认证信息：

```json
{
  "type": "req",
  "method": "connect",
  "params": {
    "client": { "id": "...", "mode": "...", "version": "..." },
    "role": "operator",
    "auth": {
      "token": "your-token"
    }
  }
}
```

## 第二层：Device Pairing

### 为什么需要设备配对？

即使知道 token，设备配对提供额外的安全层：

- **防止 token 泄露后的滥用**：攻击者需要同时拥有 token 和已配对的设备
- **设备追踪**：可以管理和撤销特定设备的访问权限
- **本地优先**：本地连接自动信任，远程连接需要显式批准

### 设备身份生成

Control UI 使用 **WebCrypto API** 生成设备密钥对：

```javascript
// 生成 ECDSA P-256 密钥对
const keyPair = await crypto.subtle.generateKey(
  { name: "ECDSA", namedCurve: "P-256" },
  true,
  ["sign", "verify"]
);
```

**重要**：WebCrypto 只在**安全上下文**中可用：
- `https://` 连接
- `http://127.0.0.1` 或 `http://localhost`（同机访问）

### 配对流程

1. **客户端发起连接**，包含设备身份信息：
   ```json
   {
     "device": {
       "id": "device-unique-id",
       "publicKey": "base64-encoded-public-key",
       "signature": "base64-encoded-signature",
       "signedAt": 1706601234567
     }
   }
   ```

2. **Gateway 验证**：
   - 设备 ID 与公钥匹配
   - 签名时间戳在 ±10 分钟内
   - 签名有效

3. **配对决策**：
   - **本地连接**（127.0.0.1）：自动批准
   - **远程连接**：创建待批准请求，等待管理员批准

### 配对存储

```
~/.clawdbot/devices/
├── pending.json    # 待批准的配对请求（5分钟过期）
└── paired.json     # 已批准的设备 + token
```

## 常见问题场景

### 场景一：Docker 容器访问

**问题**：宿主机浏览器通过 `http://127.0.0.1:18789` 访问容器内 Gateway，token 正确但提示需要配对。

**原因**：
1. 从浏览器角度：访问的是 localhost（安全上下文，可生成设备身份）
2. 从 Gateway 角度：连接来自容器网络（非本地），不自动批准配对
3. 设备配对请求被创建，但需要手动批准

**解决方案**：见下文"解决方案"章节

### 场景二：HTTP 远程访问

**问题**：通过 `http://<lan-ip>:18789` 访问，完全无法连接。

**原因**：
1. HTTP 非安全上下文，WebCrypto 不可用
2. 无法生成设备身份
3. Gateway 默认拒绝无设备身份的连接

**解决方案**：使用 HTTPS 或配置 `allowInsecureAuth`

### 场景三：Tailscale Serve 访问

**问题**：通过 `https://<magicdns>/` 访问正常。

**原因**：
1. HTTPS 是安全上下文，可生成设备身份
2. Tailscale 身份头可用于认证
3. 配对流程正常进行

## 解决方案

### 方案一：禁用设备认证（开发环境推荐）

在配置文件中添加 `allowInsecureAuth`：

```json5
// ~/.clawdbot/moltbot.json
{
  gateway: {
    bind: "0.0.0.0",
    port: 18789,
    auth: {
      mode: "token",
      token: "your-secure-token"
    },
    controlUi: {
      allowInsecureAuth: true  // 允许仅 token 认证，跳过设备配对
    }
  }
}
```

**效果**：客户端只需提供正确的 token 即可连接，无需设备身份验证。

**安全提示**：此配置降低了安全性，仅建议在受信任的网络环境中使用。

### 方案二：使用 HTTPS（生产环境推荐）

#### 选项 A：Tailscale Serve

```bash
moltbot gateway --tailscale serve
```

然后通过 `https://<magicdns>/` 访问。

#### 选项 B：反向代理

使用 nginx、Caddy 等配置 HTTPS：

```nginx
# nginx 配置示例
server {
    listen 443 ssl;
    server_name gateway.example.com;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    location / {
        proxy_pass http://127.0.0.1:18789;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

### 方案三：手动批准设备配对

如果设备已发起配对请求，可在 Gateway 所在机器执行：

```bash
# 列出待批准的设备配对
moltbot devices list

# 批准指定请求
moltbot devices approve <requestId>

# 拒绝指定请求
moltbot devices reject <requestId>
```

节点配对（旧版 API）：

```bash
# 列出待批准的节点
moltbot nodes pending

# 批准/拒绝
moltbot nodes approve <requestId>
moltbot nodes reject <requestId>
```

**注意**：待批准请求会在 **5 分钟** 后自动过期。

## Docker 完整配置示例

### docker-compose.yml

```yaml
version: '3.8'
services:
  moltbot:
    image: moltbot:latest
    ports:
      - "18789:18789"
    volumes:
      - ./config:/root/.clawdbot
    environment:
      - CLAWDBOT_GATEWAY_BIND=0.0.0.0
      - CLAWDBOT_GATEWAY_PORT=18789
```

### 配置文件

```json5
// ./config/moltbot.json
{
  gateway: {
    bind: "0.0.0.0",
    port: 18789,
    auth: {
      mode: "token",
      token: "your-32-char-random-token-here"
    },
    controlUi: {
      allowInsecureAuth: true
    }
  }
}
```

### 访问方式

1. 打开浏览器访问 `http://127.0.0.1:18789/`
2. 在 Control UI 设置面板中粘贴 token
3. 连接成功

## 安全建议

### 开发环境

- 可以使用 `allowInsecureAuth: true`
- 确保 Gateway 不暴露到公网
- 使用强随机 token

### 生产环境

- **强烈建议**使用 HTTPS（Tailscale Serve 或反向代理）
- 保持 `allowInsecureAuth: false`（默认）
- 配置防火墙限制访问来源
- 定期轮换 token
- 定期运行安全审计：
  ```bash
  moltbot security audit --deep
  ```

### 危险配置（仅调试用）

```json5
{
  gateway: {
    controlUi: {
      dangerouslyDisableDeviceAuth: true  // 完全禁用设备认证检查
    }
  }
}
```

**警告**：此配置严重降低安全性，仅在调试时临时使用，务必及时恢复。

## CLI 命令参考

| 命令 | 说明 |
|------|------|
| `moltbot devices list` | 列出所有设备（待批准 + 已批准） |
| `moltbot devices approve <id>` | 批准设备配对 |
| `moltbot devices reject <id>` | 拒绝设备配对 |
| `moltbot nodes pending` | 列出待批准节点 |
| `moltbot nodes approve <id>` | 批准节点配对 |
| `moltbot nodes reject <id>` | 拒绝节点配对 |
| `moltbot nodes status` | 查看已配对节点状态 |
| `moltbot security audit` | 运行安全审计 |
| `moltbot doctor` | 诊断常见问题 |

## 相关文档

- [Gateway 安全](/gateway/security/index.md)
- [Control UI](/web/control-ui.md)
- [远程访问](/gateway/remote.md)
- [Tailscale 配置](/gateway/tailscale.md)
- [Docker 安装](/install/docker.md)
