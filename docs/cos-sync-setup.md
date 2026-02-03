# COS 同步系统配置指南

本文档介绍如何在其他项目中配置腾讯云 COS 自动同步系统，实现 Git 提交时自动上传/删除文件并刷新 CDN 缓存。

## 功能特性

- **自动上传**：Git 提交时自动将指定目录的新增/修改文件上传到 COS
- **自动删除**：Git 提交时自动从 COS 删除已删除的文件
- **CDN 刷新**：文件变更后自动刷新 CDN 缓存（可选）
- **可配置目录**：支持自定义同步目录
- **双重上传方式**：优先使用 coscli，未安装时自动降级为 curl

## 快速开始

### 1. 复制脚本文件

将 `scripts/sync-packages-to-cos.sh` 复制到目标项目的 `scripts/` 目录：

```bash
mkdir -p scripts
cp /path/to/sync-packages-to-cos.sh scripts/
chmod +x scripts/sync-packages-to-cos.sh
```

### 2. 创建配置文件

在项目根目录创建 `.cos.env` 文件：

```bash
# 腾讯云 COS 凭证（必填）
COS_SECRET_ID=your_secret_id
COS_SECRET_KEY=your_secret_key
COS_REGION=ap-guangzhou
COS_BUCKET=your-bucket-name

# 远程路径前缀（可选）
COS_PREFIX=project_name

# 同步目录（可选，默认 packages）
COS_SYNC_DIR=html

# CDN URL（可选，配置后自动刷新缓存）
COS_CDN_URL=https://your-cdn-domain.com
```

### 3. 添加到 .gitignore

将配置文件添加到 `.gitignore` 以保护敏感凭证：

```bash
echo ".cos.env" >> .gitignore
```

### 4. 配置 Git Hook

创建或编辑 `.git/hooks/post-commit`：

```bash
#!/bin/bash
# Post-commit hook: sync files to COS

SCRIPT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
if [ -f "$SCRIPT_DIR/scripts/sync-packages-to-cos.sh" ]; then
    "$SCRIPT_DIR/scripts/sync-packages-to-cos.sh"
fi
```

添加执行权限：

```bash
chmod +x .git/hooks/post-commit
```

## 配置参数说明

| 参数 | 必填 | 说明 | 示例 |
|------|------|------|------|
| `COS_SECRET_ID` | 是 | 腾讯云 API SecretId | `AKIDxxxxxxxx` |
| `COS_SECRET_KEY` | 是 | 腾讯云 API SecretKey | `xxxxxxxx` |
| `COS_REGION` | 是 | COS 存储桶地域 | `ap-guangzhou` |
| `COS_BUCKET` | 是 | COS 存储桶名称 | `my-bucket-1251285021` |
| `COS_PREFIX` | 否 | 远程路径前缀 | `project/assets` |
| `COS_SYNC_DIR` | 否 | 本地同步目录（默认 `packages`） | `html` |
| `COS_CDN_URL` | 否 | CDN 域名（配置后启用缓存刷新） | `https://cdn.example.com` |

## 目录结构示例

```
your-project/
├── .cos.env              # COS 配置文件（不提交到 Git）
├── .git/
│   └── hooks/
│       └── post-commit   # Git 钩子
├── .gitignore            # 包含 .cos.env
├── scripts/
│   └── sync-packages-to-cos.sh
└── html/                 # 同步目录（COS_SYNC_DIR=html）
    ├── index.html
    ├── styles.css
    └── images/
        └── logo.png
```

## 工作流程

1. 在 `html/` 目录下添加/修改/删除文件
2. 执行 `git add` 和 `git commit`
3. post-commit 钩子自动触发同步脚本
4. 脚本检测变更文件并执行相应操作：
   - 新增/修改文件 → 上传到 COS
   - 删除文件 → 从 COS 删除
5. 如配置了 CDN，自动刷新变更文件的缓存

## 手动执行

如需手动同步，可直接运行脚本：

```bash
./scripts/sync-packages-to-cos.sh
```

## 常见问题

### Q: 如何获取腾讯云 API 密钥？

1. 登录 [腾讯云控制台](https://console.cloud.tencent.com/)
2. 进入 **访问管理** > **访问密钥** > **API密钥管理**
3. 创建或查看 SecretId 和 SecretKey

### Q: 如何查看 COS 存储桶名称和地域？

1. 登录 [COS 控制台](https://console.cloud.tencent.com/cos)
2. 在存储桶列表中查看完整名称（包含 AppId 后缀）和所属地域

### Q: CDN 刷新不生效？

- 确保 `COS_CDN_URL` 配置正确
- 确保 API 密钥有 CDN 操作权限
- 检查脚本输出的 CDN 刷新响应信息

### Q: 如何同步多个目录？

当前脚本仅支持单目录同步。如需同步多个目录，可以：
1. 复制脚本并配置不同的 `.cos.env` 文件
2. 或将多个目录放在同一父目录下，设置 `COS_SYNC_DIR` 为父目录

### Q: 上传失败怎么办？

1. 检查 `.cos.env` 配置是否正确
2. 确认网络连接正常
3. 验证 API 密钥权限是否包含 COS 读写权限
4. 查看脚本输出的错误信息

## 安全建议

- **不要**将 `.cos.env` 提交到 Git 仓库
- 定期轮换 API 密钥
- 使用子账号并授予最小必要权限
- 生产环境建议使用临时密钥

## 依赖要求

- bash
- curl
- openssl（用于签名计算）
- git
- coscli（可选，未安装时使用 curl）
