# Playlet

AI 驱动的影视内容生成系统，基于 Vue 3 + Vite + Rust 后端构建。从故事创意或剧本自动生成动态视频内容。

## 技术栈

- **框架**: Vue 3 Composition API + Vite
- **包管理器**: Bun
- **数据库**: SQLite（Rust `rusqlite`）
- **UI**: Tailwind CSS + shadcn-vue
- **AI 服务**: Google Gemini、阿里云 Qwen、DeepSeek、可灵 AI、火山引擎 Doubao

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
GEMINI_API_KEY=            # Google Gemini API 密钥，支持多个（逗号/分号/换行分隔）
# GEMINI_API_KEY=key1,key2,key3
QWEN_API_KEY=              # 阿里云 Qwen (DashScope) API 密钥
DEEPSEEK_API_KEY=          # DeepSeek 官方 API 密钥（OpenAI 兼容）
KLING_ACCESS_KEY=          # 可灵 AI Access Key
KLING_SECRET_KEY=          # 可灵 AI Secret Key
KLING_BASE_URL=            # 可选，默认 https://api-beijing.klingai.com
VOLCENGINE_API_KEY=        # 火山引擎 (Doubao) API 密钥

# 可选：火山云对象存储 TOS（启用后图片/视频优先上传云端）
# TOS_ENABLED=true
# TOS_ACCESS_KEY=
# TOS_SECRET_KEY=
# TOS_REGION=cn-beijing
# TOS_ENDPOINT=tos-cn-beijing.volces.com
# TOS_BUCKET=
# TOS_KEY_PREFIX=playlet-assets
# TOS_PUBLIC_BASE_URL=      # 可选，建议填写 CDN/自定义域名
# TOS_IS_CUSTOM_DOMAIN=false
# TOS_PROXY=                # 可选，仅对 TOS 生效；默认直连，不读取 HTTP_PROXY/HTTPS_PROXY

# 可选
HTTP_PROXY=                # Gemini 代理（国内需要）
HTTPS_PROXY=
OUTPUT_DIR=./output
MAX_CONCURRENT_REQUESTS=3
RUST_BACKEND_URL=http://127.0.0.1:43127 # Vite dev 代理目标
```

## 常用命令

```bash
bun dev                    # 启动开发服务器
bun dev:backend            # 仅启动 Rust 后端（127.0.0.1:43127）
bun dev:frontend           # 仅启动 Vite 前端（开发代理 /api 到 Rust）
bun build                  # 构建生产版本
bun build:desktop          # 桌面端前端构建
bun preview                # 以 Rust 后端预览生产构建
bun desktop:dev            # 启动 Tauri 本地客户端（开发模式）
bun desktop:build          # 构建 Tauri 本地客户端安装包
bun desktop:sync-env        # 同步项目 .env 到桌面客户端数据目录
bun desktop:install        # 一键构建 + 安装 + 启动桌面客户端

# 代码质量
bun lint                   # 运行 ESLint
bun lint:fix               # 修复 ESLint 问题
bun typecheck              # TypeScript 类型检查
```

## 本地客户端（Tauri）

项目已切换为 `Tauri + Rust 内嵌后端` 架构（运行时不依赖 Node/Bun）：

- `bun desktop:dev`：启动 Tauri 客户端（Rust 后端监听 `127.0.0.1:43127`）。
- `bun desktop:build`：先执行 `bun build:desktop`，再打包桌面应用。
- `bun desktop:sync-env`：将项目根目录 `.env` 同步到 `~/Library/Application Support/com.playlet.desktop/.env`（会自动备份旧文件）。
- `bun desktop:install`：一键执行“构建 app bundle → 安装到 `/Applications`（无权限时自动回退 `~/Applications`）→ 启动客户端”。
- 打包时会将前端静态资源 `.output/public` 写入应用资源目录 `web/public`。
- 可用 `PLAYLET_INSTALL_DIR` 指定安装目录，例如：`PLAYLET_INSTALL_DIR="$HOME/Applications" bun desktop:install`
- `desktop:install` 默认会自动同步 `.env`；如不希望自动同步可设置 `PLAYLET_SYNC_ENV=0`。

### 打包版环境变量加载说明（重要）

- 开发模式（`bun dev` / `bun desktop:dev`）默认读取项目根目录 `.env`。
- 打包后的桌面客户端不会保证以项目目录为工作目录，因此项目根目录 `.env` 可能不会生效。
- 桌面客户端启动时会额外尝试读取以下 `.env`（若存在）：
  - `~/Library/Application Support/com.playlet.desktop/.env`
  - `app_config_dir/.env`
- 也可通过环境变量显式指定：`PLAYLET_ENV_FILE=/absolute/path/to/.env`

如果“云端文件”页面为空或报 `TOS 未启用或配置不完整`，请优先检查上述路径中的 `.env` 是否包含完整 `TOS_*` 配置。

## Rust 后端（Web/本地）

- `bun dev` 会并行启动 `Vite 前端 + Rust 后端`。
- `bun preview` 会直接启动 Rust 后端并托管 `.output/public`。
- `server/` TS 后端目录已整体移除，后端服务逻辑统一在 Rust 中实现。
- 可通过以下环境变量覆盖后端启动参数：
  - `PLAYLET_BACKEND_HOST`（默认 `127.0.0.1`）
  - `PLAYLET_BACKEND_PORT`（默认 `43127`）
  - `PLAYLET_WEB_DIR`（默认优先 `.output/public`，不存在则回退 `public`）

## 发布版本

使用自动发版脚本发布新版本：

```bash
bun run release          # patch 版本 +1 (1.0.0 → 1.0.1)
bun run release minor    # minor 版本 +1 (1.0.0 → 1.1.0)
bun run release major    # major 版本 +1 (1.0.0 → 2.0.0)
```

脚本会自动：
1. 更新 `package.json` 版本号
2. 创建 git commit 和 tag
3. 推送到 GitHub 触发 Actions 构建
4. 如果配置了 `GITHUB_TOKEN`，临时将私有仓库设为公开（免费使用 Actions），构建完成后自动恢复私有

**私有仓库免费构建**：在环境变量中设置 `GITHUB_TOKEN`（需要 repo 权限），脚本会在构建期间临时公开仓库。

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
| `DEPLOY_PATH` | 服务器上的部署目录，如 `/home/user/playlet` |

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
