# AWS Bedrock Claude 模型支持实施方案

## 摘要

本文档分析了在 Moltbot 项目中增加 AWS Bedrock Claude 模型支持的方案。经过代码分析，**该项目已经支持 AWS Bedrock**，包括自动模型发现和 Converse API 流式调用。本文档将说明现有实现、配置方法以及可能的增强方案。

---

## 1. 现有支持分析

### 1.1 已实现的功能

项目**已经完整支持** AWS Bedrock，包括:

| 功能 | 状态 | 实现位置 |
|------|------|----------|
| Bedrock Converse API | ✅ 已支持 | `bedrock-converse-stream` API 类型 |
| AWS SDK 认证链 | ✅ 已支持 | 环境变量、Profile、Instance Role |
| 自动模型发现 | ✅ 已支持 | `src/agents/bedrock-discovery.ts` |
| Claude on Bedrock | ✅ 已支持 | 通过提供商过滤器 `providerFilter: ["anthropic"]` |
| 流式响应 | ✅ 已支持 | 通过 pi-coding-agent 库 |

### 1.2 关键代码文件

```
src/agents/bedrock-discovery.ts          # Bedrock 模型自动发现
src/agents/models-config.providers.ts    # 提供商配置构建 (含 resolveImplicitBedrockProvider)
src/agents/model-auth.ts                 # AWS 凭证解析 (resolveAwsSdkEnvVarName)
src/config/types.models.ts               # 类型定义 (BedrockDiscoveryConfig, ModelApi)
docs/bedrock.md                          # Bedrock 配置文档
```

### 1.3 支持的认证方式

```bash
# 方式 1: Bearer Token (优先级最高)
export AWS_BEARER_TOKEN_BEDROCK="..."

# 方式 2: Access Key + Secret Key
export AWS_ACCESS_KEY_ID="AKIA..."
export AWS_SECRET_ACCESS_KEY="..."

# 方式 3: AWS Profile
export AWS_PROFILE="your-profile"

# 方式 4: EC2 Instance Role (需设置 AWS_PROFILE=default 作为信号)
export AWS_PROFILE=default
```

---

## 2. 配置方法

### 2.1 自动发现模式 (推荐)

在 `~/.clawdbot/config.json` 中启用自动发现:

```json5
{
  "models": {
    "bedrockDiscovery": {
      "enabled": true,
      "region": "us-east-1",
      "providerFilter": ["anthropic"],  // 只发现 Claude 模型
      "refreshInterval": 3600,           // 1小时刷新一次
      "defaultContextWindow": 200000,    // Claude 的上下文窗口
      "defaultMaxTokens": 8192
    }
  },
  "agents": {
    "defaults": {
      "model": {
        "primary": "amazon-bedrock/anthropic.claude-3-5-sonnet-20241022-v2:0"
      }
    }
  }
}
```

### 2.2 手动配置模式

```json5
{
  "models": {
    "providers": {
      "amazon-bedrock": {
        "baseUrl": "https://bedrock-runtime.us-east-1.amazonaws.com",
        "api": "bedrock-converse-stream",
        "auth": "aws-sdk",
        "models": [
          {
            "id": "anthropic.claude-3-5-sonnet-20241022-v2:0",
            "name": "Claude 3.5 Sonnet v2 (Bedrock)",
            "reasoning": false,
            "input": ["text", "image"],
            "cost": { "input": 3, "output": 15, "cacheRead": 0.3, "cacheWrite": 3.75 },
            "contextWindow": 200000,
            "maxTokens": 8192
          },
          {
            "id": "anthropic.claude-opus-4-5-20251101-v1:0",
            "name": "Claude Opus 4.5 (Bedrock)",
            "reasoning": true,
            "input": ["text", "image"],
            "cost": { "input": 15, "output": 75, "cacheRead": 1.5, "cacheWrite": 30 },
            "contextWindow": 200000,
            "maxTokens": 16000
          }
        ]
      }
    }
  }
}
```

---

## 3. 可能的增强方案

尽管基本功能已完整，以下增强可以改善用户体验:

### 3.1 增强方案 A: 预置 Claude 模型目录

**目标**: 提供 Bedrock Claude 模型的完整元数据，避免自动发现时缺少成本/上下文窗口等信息。

**实施内容**:
1. 创建 `src/agents/bedrock-claude-models.ts` - Claude on Bedrock 模型目录
2. 包含所有 Claude 模型的完整元数据 (ID, 名称, 成本, 上下文窗口等)
3. 在自动发现时合并预置元数据

**预估改动**:
- 新增 1 个文件 (~150 行)
- 修改 `bedrock-discovery.ts` (~30 行)

### 3.2 增强方案 B: 跨区域模型发现

**目标**: 支持多区域 Bedrock 模型发现和自动选择。

**实施内容**:
1. 配置支持 `regions: ["us-east-1", "us-west-2", "eu-west-1"]`
2. 并行发现所有区域的模型
3. 模型 ID 中包含区域信息

**预估改动**:
- 修改 `bedrock-discovery.ts` (~100 行)
- 修改类型定义 (~10 行)

### 3.3 增强方案 C: Bedrock 认证 CLI 向导

**目标**: 提供交互式配置向导，简化 AWS 凭证设置。

**实施内容**:
1. `moltbot login amazon-bedrock` 命令
2. 引导用户选择认证方式
3. 验证凭证并自动配置

**预估改动**:
- 新增认证插件 (~200 行)
- 添加 CLI 命令 (~100 行)

### 3.4 增强方案 D: 改进 EC2 Instance Role 检测

**目标**: 自动检测 EC2 IMDS 凭证，无需手动设置 `AWS_PROFILE=default`。

**实施内容**:
1. 在 `resolveAwsSdkEnvVarName()` 中添加 IMDS 探测
2. 异步检测 `http://169.254.169.254/latest/meta-data/iam/security-credentials/`
3. 缓存检测结果

**预估改动**:
- 修改 `model-auth.ts` (~50 行)

---

## 4. 推荐实施路径

### 4.1 如果只是需要使用 Bedrock Claude

**无需任何代码改动**，按以下步骤配置即可:

```bash
# 1. 设置 AWS 凭证
export AWS_ACCESS_KEY_ID="AKIA..."
export AWS_SECRET_ACCESS_KEY="..."
export AWS_REGION="us-east-1"

# 2. 启用 Bedrock 发现
moltbot config set models.bedrockDiscovery.enabled true
moltbot config set models.bedrockDiscovery.providerFilter '["anthropic"]'

# 3. 设置默认模型
moltbot config set agents.defaults.model.primary "amazon-bedrock/anthropic.claude-3-5-sonnet-20241022-v2:0"

# 4. 验证
moltbot models list | grep bedrock
```

### 4.2 如果需要增强功能

推荐按以下优先级实施:

1. **方案 A (预置模型目录)** - 低成本高收益，改善自动发现的元数据质量
2. **方案 D (IMDS 检测)** - 改善 EC2 用户体验
3. **方案 C (认证向导)** - 改善新用户上手体验
4. **方案 B (跨区域)** - 高级功能，按需实施

---

## 5. 详细实施方案 A: 预置 Claude 模型目录

如果确认需要实施方案 A，以下是详细计划:

### 5.1 新建文件: `src/agents/bedrock-claude-models.ts`

```typescript
// Bedrock Claude 模型完整元数据
import type { ModelDefinitionConfig } from "../config/types.models.js";

export const BEDROCK_CLAUDE_MODEL_CATALOG: ModelDefinitionConfig[] = [
  // Claude 3.5 Sonnet v2
  {
    id: "anthropic.claude-3-5-sonnet-20241022-v2:0",
    name: "Claude 3.5 Sonnet v2",
    reasoning: false,
    input: ["text", "image"],
    cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
    contextWindow: 200000,
    maxTokens: 8192,
  },
  // Claude 3.5 Haiku
  {
    id: "anthropic.claude-3-5-haiku-20241022-v1:0",
    name: "Claude 3.5 Haiku",
    reasoning: false,
    input: ["text", "image"],
    cost: { input: 0.8, output: 4, cacheRead: 0.08, cacheWrite: 1 },
    contextWindow: 200000,
    maxTokens: 8192,
  },
  // Claude Opus 4.5
  {
    id: "anthropic.claude-opus-4-5-20251101-v1:0",
    name: "Claude Opus 4.5",
    reasoning: true,
    input: ["text", "image"],
    cost: { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 30 },
    contextWindow: 200000,
    maxTokens: 16000,
  },
  // Claude Sonnet 4
  {
    id: "anthropic.claude-sonnet-4-20250514-v1:0",
    name: "Claude Sonnet 4",
    reasoning: true,
    input: ["text", "image"],
    cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
    contextWindow: 200000,
    maxTokens: 16000,
  },
  // ... 更多模型
];

export function enrichBedrockModel(
  discovered: ModelDefinitionConfig
): ModelDefinitionConfig {
  const catalog = BEDROCK_CLAUDE_MODEL_CATALOG.find(
    (m) => m.id === discovered.id || discovered.id.startsWith(m.id.split(":")[0])
  );
  if (!catalog) return discovered;
  return {
    ...discovered,
    name: catalog.name,
    cost: catalog.cost,
    contextWindow: catalog.contextWindow,
    maxTokens: catalog.maxTokens,
    reasoning: catalog.reasoning,
    input: catalog.input,
  };
}
```

### 5.2 修改 `src/agents/bedrock-discovery.ts`

在 `discoverBedrockModels()` 函数中添加元数据增强:

```typescript
import { enrichBedrockModel } from "./bedrock-claude-models.js";

// 在 toModelDefinition 后添加:
discovered.push(
  enrichBedrockModel(
    toModelDefinition(summary, {
      contextWindow: defaultContextWindow,
      maxTokens: defaultMaxTokens,
    })
  )
);
```

### 5.3 测试验证

```bash
# 运行测试
pnpm test src/agents/bedrock

# 验证模型发现
moltbot models list --json | jq '.[] | select(.provider == "amazon-bedrock")'
```

---

## 6. AWS IAM 权限要求

使用 Bedrock Claude 需要以下 IAM 权限:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "bedrock:InvokeModel",
        "bedrock:InvokeModelWithResponseStream",
        "bedrock:ListFoundationModels"
      ],
      "Resource": "*"
    }
  ]
}
```

或使用托管策略: `arn:aws:iam::aws:policy/AmazonBedrockFullAccess`

---

## 7. 结论

**现状**: Moltbot 已完整支持 AWS Bedrock Claude 模型，无需任何代码改动即可使用。

**建议**:
1. 如果只是使用 Bedrock Claude，按第 4.1 节配置即可
2. 如需增强，推荐先实施方案 A (预置模型目录) 以改善元数据质量
3. 其他增强方案可按需逐步实施

---

## 附录: 相关文件路径

| 文件 | 说明 |
|------|------|
| `src/agents/bedrock-discovery.ts` | Bedrock 模型自动发现 |
| `src/agents/models-config.providers.ts` | 提供商配置构建 |
| `src/agents/model-auth.ts` | AWS 凭证解析 |
| `src/config/types.models.ts` | 模型类型定义 |
| `docs/bedrock.md` | Bedrock 配置文档 |
| `src/config/zod-schema.core.ts` | 配置验证模式 |
