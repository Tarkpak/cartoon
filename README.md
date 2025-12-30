# Manju

AI 驱动的漫画/视频生成系统，基于 Nuxt.js 4 构建。从故事创意或剧本自动生成动态漫画内容。

## 技术栈

- **框架**: Nuxt.js 4 + Vue 3 Composition API
- **包管理器**: Bun
- **数据库**: SQLite + Drizzle ORM
- **UI**: Tailwind CSS + shadcn-vue
- **AI 服务**: Google Gemini、阿里云 Qwen、火山引擎 Doubao

## 快速开始

```bash
# 安装依赖
bun install

# 启动开发服务器
bun dev

# 构建生产版本
bun build
```

## 环境变量

在 `.env` 文件中配置：

```env
GEMINI_API_KEY=            # Google Gemini API 密钥
QWEN_API_KEY=              # 阿里云 Qwen (DashScope) API 密钥
VOLCENGINE_API_KEY=        # 火山引擎 (Doubao) API 密钥

# 可选
HTTP_PROXY=                # Gemini 代理（国内需要）
HTTPS_PROXY=
OUTPUT_DIR=./output
MAX_CONCURRENT_REQUESTS=3
```

## 常用命令

```bash
bun dev                    # 启动开发服务器
bun build                  # 构建生产版本
bun preview                # 预览生产构建

# 数据库
bun db:generate            # 生成 Drizzle 迁移
bun db:migrate             # 运行迁移
bun db:push                # 推送 schema 变更
bun db:studio              # 打开 Drizzle Studio

# 代码质量
bun lint                   # 运行 ESLint
bun lint:fix               # 修复 ESLint 问题
bun typecheck              # TypeScript 类型检查
```

## 自动部署

项目配置了 GitHub Actions，推送到 `master` 分支时自动构建并部署到服务器。

### 配置步骤

1. 在 GitHub 仓库的 **Settings → Secrets and variables → Actions** 中添加以下 secrets：

| Secret 名称 | 说明 |
|------------|------|
| `SSH_PRIVATE_KEY` | 服务器 SSH 私钥（完整内容，包括 BEGIN/END 行） |
| `REMOTE_HOST` | 服务器 IP 或域名 |
| `REMOTE_USER` | SSH 登录用户名 |
| `REMOTE_PORT` | SSH 端口（可选，默认 22） |
| `DEPLOY_PATH` | 服务器上的部署目录，如 `/home/user/manju` |

2. 生成部署专用 SSH 密钥（如果需要）：

```bash
# 生成密钥
ssh-keygen -t ed25519 -C "github-deploy" -f ~/.ssh/deploy_key

# 将公钥添加到服务器
ssh-copy-id -i ~/.ssh/deploy_key.pub user@your-server

# 将私钥内容复制到 GitHub Secrets
cat ~/.ssh/deploy_key
```

### 部署流程

1. 推送代码到 `master` 分支
2. GitHub Actions 自动触发构建
3. 使用 Bun 安装依赖并构建项目
4. 通过 SSH + rsync 同步 `.output/` 到服务器
5. PM2 自动重启应用

## License

MIT
