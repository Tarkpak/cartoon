# 后台管控建设规划与落地说明

## 背景

当前项目定位是重客户端应用：桌面端负责项目编辑、素材生成流程、本地文件管理、FFmpeg、本地缓存和预览；本地 Rust/Axum 后端提供 `/api/...` 接口，并使用本地 SQLite 保存项目、提示词、模型配置、日志和供应商 Key。

新增后台的目标不是把现有桌面端完全改成 SaaS，而是在保留重客户端能力的前提下，增加个人用户体系和统一管控能力。

## 目标

后台需要支持：

- 查看每个用户创建了哪些项目。
- 查看每个用户自定义了哪些提示词。
- 查看每个用户选择了哪些业务模型。
- 统一管理模型供应商 Key，普通用户不再在本地配置 Key，由后台下发给客户端调用模型。
- 记录用户的模型调用、生成任务、失败原因和基础审计日志。

不需要团队、组织、租户协作等复杂概念，数据边界以 `user_id` 为准。

## 已确认决策

- 后台采用单机部署。
- 技术栈采用 NuxtJS + Naive UI + SQLite。
- 登录方式采用账号密码。
- 不开放用户自助注册，由管理员创建用户。
- 需要设备管理，后台可禁用用户或设备。
- 离线不可用；桌面端启动和使用核心能力时必须连接后台。
- 模型调用继续走客户端，后台只负责下发供应商 Key 和模型策略。
- 供应商 Key 为全局 Key，不做用户级 Key。
- 首期模型供应商全部纳入：OpenAI、Gemini、通义、火山、可灵、自定义 OpenAI 兼容服务。
- Key 下发策略为客户端每次启动时拉取。
- 后台需要查看完整项目信息。
- 用户可以自己选择业务模型，后台提供默认值，用户可覆盖。
- 提示词全量同步到后台。
- 生成结果媒体文件不上传后台；后台只保存 CDN URL 或对象存储 key。
- 调用日志完整保留。
- 首期后台页面包括：用户管理、用户项目、用户提示词、用户模型选择、供应商 Key、调用日志。
- 每个用户最多几台设备、是否限制同时在线、禁用后多久失效都做成后台可配置项。
- 初始管理员通过首次访问后台初始化。
- 密码策略不要求强密码、不做密码重置、不做登录失败锁定。
- 日志超过容量后归档，容量阈值做成可配置项。

## 当前落地状态

本目录已经包含首版后台实现：

- Nuxt 3 + Naive UI 管理后台。
- Bun 运行与构建脚本，生产构建使用 Nitro `bun` preset。
- SQLite 使用 Bun 内置 `bun:sqlite`，不依赖 `better-sqlite3` 或 `node:sqlite`。
- 首次访问 `/setup` 初始化管理员。
- 后台页面：总览、用户管理、用户详情、供应商 Key、调用日志、系统设置。
- 客户端 API：登录、Bootstrap、Key 下发、设备心跳、项目同步、提示词同步、模型偏好同步、调用日志上报。
- 管理 API：用户、设备、供应商、设置、用户项目、用户提示词、用户模型偏好、调用日志、审计日志。
- 供应商 Key 加密存储，后台不回显明文；客户端启动或登录后拉取，进入本地 Rust 后端内存态。
- 禁用用户或设备后，已登录会话按 `disabledGraceSeconds` 配置宽限期失效；新登录立即拒绝。
- 日志超过 `logArchiveMaxRows` 后写入 `log_archives` 并标记归档。
- 客户端改造已接入后台登录、启动 Bootstrap、心跳、Key 覆盖、项目/提示词/模型偏好/调用日志同步。

运行命令：

```bash
bun install
bun run dev
bun run test
bun run typecheck
bun run build
```

PM2 部署：

```bash
cd backend
bun run deploy:pm2
```

默认使用 PM2 应用名 `playlet-admin-backend`，监听 `0.0.0.0:43200`，数据目录为 `backend/data`。生产服务器可按需覆盖：

```bash
HOST=0.0.0.0 PLAYLET_ADMIN_PORT=43200 PLAYLET_ADMIN_DATA_DIR=/var/lib/playlet-admin bun run deploy:pm2
```

客户端版本管理从后台云存储配置同步，默认读取 `Key Prefix/desktop-updater/latest.json`，并扫描同目录下已上传的桌面安装包；不需要配置 GitHub 仓库或 token。

首次在服务器上配置开机自启时执行：

```bash
pm2 startup
pm2 save
```

默认后台地址：

```text
开发环境：http://127.0.0.1:43200
生产环境：http://42.192.62.105:43200
```

客户端登录页默认填写该地址。客户端离线或未登录后台时会被路由守卫引导到 `/login`。

## 可配置项

- 每个用户最大设备数。
- 是否限制同时在线设备数。
- 用户或设备禁用后的客户端失效时间。
- 日志归档容量阈值。

当前 Key 下发策略为返回所有启用供应商的全局 Key；后续如要缩小 Key 暴露面，可以改为只下发当前用户业务模型涉及的供应商 Key。

## 用户积分

管理后台在用户列表和用户详情中展示积分余额与累计消耗。管理员可在用户详情中手动增加或减少积分，每次调整必须填写原因并写入积分流水和审计日志。

成功上报到后台的模型调用会按“系统设置 → 积分计费规则”自动扣分，失败调用不扣分。同一条模型调用日志只会产生一次扣分。桌面端会为日志生成稳定事件 ID，上传失败时保存在本地并定时重试；后台以“用户 + 事件 ID”幂等入库和扣分。

管理员可以新增按操作、供应商和模型匹配的计费规则。匹配时优先使用更具体的规则，自定义规则可删除，默认规则只能停用。默认规则如下：

| 操作 | 默认积分 |
|------|---------:|
| 文本生成 | 1 |
| 图片生成 | 10 |
| 视频生成 | 50 |
| 语音生成 | 2 |
| 其他操作 | 1 |

用户详情支持按流水类型和日期范围筛选、查看区间增加/扣减/模型消耗统计，并导出 CSV。后台总览展示全部用户积分余额及当日、本月模型消耗。

积分用于内部统计，不阻断模型调用，余额允许为负数。异步生成只在最终成功时扣分，测试模型不会额外重复扣分，积分功能上线前的历史调用日志不会自动回溯扣分。

## 总体架构

采用“重客户端 + 单机后台控制面 + 后台 Key 下发”的架构。

```text
桌面端 Vue/Tauri
  |
  | 登录、设备校验、策略拉取、Key 拉取、项目/提示词/模型偏好/日志同步
  v
Nuxt 后台 API + SQLite
  |
  | 用户、设备、Key、默认模型、提示词、项目、调用日志、管理后台
  v
桌面端本地 Rust/Axum 后端
  |
  | 使用后台下发的 Key 调用供应商
  v
OpenAI / Gemini / 通义 / 火山 / 可灵 / 自定义 OpenAI 兼容服务
```

关键原则：

- 桌面端继续负责重客户端能力。
- 后台负责用户、设备、策略、Key、审计和可视化管理。
- 模型调用仍由客户端执行，后台下发全局 Key。
- 桌面端离线不可用；禁用用户或设备后应尽快失效。
- 后台同步完整项目结构数据，但不上传生成结果媒体文件。
- Key 下发到客户端意味着 Key 无法做到绝对保密，只能通过登录、设备校验、启动拉取、审计和本地加密降低风险。

## 用户模型

只保留个人用户和管理员。

### 用户角色

- `admin`：后台管理员，可以查看所有用户、项目、提示词、模型选择、调用日志，并配置供应商 Key。
- `user`：普通用户，只能登录桌面端，创建自己的项目，维护自己的提示词和模型偏好。

### users

```text
id
account
email
phone
display_name
password_hash
role
status
last_login_at
created_at
updated_at
```

`status` 建议包含：

- `active`
- `disabled`

### user_devices

```text
id
user_id
device_id
device_name
os
client_version
status
last_seen_at
created_at
updated_at
```

用途：

- 记录用户在哪些设备登录过。
- 后台可以禁用某个用户或某台设备。
- 桌面端启动时校验设备授权状态。

## 后台核心模块

### 1. 用户管理

功能：

- 用户列表。
- 用户详情。
- 启用/禁用用户。
- 查看用户设备。
- 查看用户最近登录时间。
- 查看用户项目、提示词、模型偏好和调用记录。

### 2. 项目全量同步

当前本地 `projects`、`scripts`、`scenes`、`characters`、`video_tasks`、`generated_videos` 等表保存项目主体数据。后台需要查看完整项目信息，因此需要同步项目结构化数据。

云端表：`user_projects`

```text
id
user_id
local_project_id
name
description
script_parse_mode
style_id
aspect_ratio
status
summary_json
local_created_at
local_updated_at
last_synced_at
created_at
updated_at
```

云端表：`user_project_snapshots`

```text
id
user_id
project_id
snapshot_json
snapshot_version
created_at
```

`snapshot_json` 建议保存客户端序列化后的完整项目结构，包括：

- 项目基础信息。
- 剧本和解析结果。
- 场景列表。
- 角色列表。
- 道具、环境、资产引用。
- 生成任务状态、生成参数、错误信息。
- 生成结果 CDN URL 或对象存储 key。

不保存：

- 图片二进制。
- 视频二进制。
- 音频二进制。
- 只存在用户本机的临时文件。

后台展示：

- 用户创建了哪些项目。
- 项目名称、状态、风格、画幅、创建时间、更新时间。
- 剧本、场景、角色、资产引用、生成任务和生成参数。
- 生成结果媒体文件不在后台保存；后台通过项目中的 CDN URL 或对象存储 key 展示图片、视频、音频。

桌面端本地 `projects` 建议增加：

```text
cloud_project_id
cloud_user_id
sync_status
last_synced_at
```

### 3. 提示词管理

当前提示词相关配置主要存在本地 `system_config`，包括：

- `prompt_templates_default`
- `prompt_profiles_default`
- `prompt_versions_default`
- `prompt_profile_state_default`

云端建议拆为用户维度表。

#### user_prompt_profiles

```text
id
user_id
name
description
is_active
created_at
updated_at
```

#### user_prompt_templates

```text
id
user_id
profile_id
template_key
title
content
source
created_at
updated_at
```

`source` 可取：

- `system_default`
- `user_custom`

#### user_prompt_versions

```text
id
user_id
template_id
content
change_summary
created_at
```

后台展示：

- 用户自定义了哪些提示词。
- 当前启用的 Prompt Profile。
- 每个模板的当前内容和历史版本。
- 是否基于系统默认模板修改。
- 后台默认模板与用户覆盖值。

### 4. 业务模型偏好

当前本地模型配置主要包括：

- `selected_models`
- `workflow_models`
- `workflow_model_options`

云端表：`user_model_preferences`

```text
id
user_id
workflow_step
model_id
model_options_json
created_at
updated_at
```

后台展示：

- 剧本解析使用哪个模型。
- 角色图生成使用哪个模型。
- 场景图生成使用哪个模型。
- 道具/环境/视频生成使用哪个模型。
- 用户是否覆盖了后台默认配置。

### 5. 供应商 Key 管控与下发

Key 统一由后台管理，不再由普通用户在桌面端填写。

云端表：`model_providers`

```text
id
provider_key
display_name
base_url
enabled
created_at
updated_at
```

云端表：`provider_credentials`

```text
id
provider_id
encrypted_api_key
encrypted_access_key
encrypted_secret_key
encrypted_security_token
status
created_at
updated_at
```

要求：

- Key 必须加密存储。
- 后台只展示“已配置/未配置”，不回显明文。
- 修改 Key 需要写入审计日志。
- 普通桌面用户不再看到 Key 输入框，或只显示“由后台统一管理”。
- 客户端登录并通过设备校验后，才能拉取 Key。
- Key 在客户端每次启动时拉取，客户端不应长期明文持久化。
- 因为模型调用在客户端执行，Key 一旦下发就存在被本机提取的风险，不能达到模型网关模式下的强管控级别。

### 6. Key 下发与客户端直连模型

模型调用继续由客户端执行。后台只提供供应商配置、全局 Key、默认业务模型和可用模型策略。

桌面端调用后台：

```text
GET /api/client/bootstrap
GET /api/client/provider-credentials
```

后台负责：

- 校验用户登录态。
- 校验用户状态和设备状态。
- 返回可用模型列表。
- 返回后台默认业务模型。
- 返回用户是否允许覆盖默认模型。
- 返回客户端调用供应商所需的全局 Key。

客户端负责：

- 使用后台下发的 Key 调用真实供应商。
- 调用完成后上报完整日志。
- 调用失败时上报错误信息和请求上下文。

### 7. 调用日志与审计

云端表：`model_call_logs`

```text
id
user_id
request_id
provider
model_id
operation
project_id
scene_id
status
duration_ms
estimated_cost
error_message
request_json
response_json
created_at
```

云端表：`audit_logs`

```text
id
actor_user_id
action
target_type
target_id
metadata_json
ip
user_agent
created_at
```

后台展示：

- 用户调用了哪些模型。
- 哪些调用失败。
- 每个用户的生成次数。
- 每个模型的使用量。
- 管理员修改 Key、禁用用户、调整配置等审计记录。
- 完整请求参数、Prompt、响应摘要或完整响应。

注意：模型调用由客户端执行，因此调用日志依赖客户端上报。后台可以要求客户端使用前后均上报日志，但无法像模型网关一样从服务端强制保证日志完整性。

## 桌面端改造点

### 1. 登录与会话

新增桌面端登录流程：

- `POST /auth/login`
- `POST /auth/logout`
- `GET /me`

当前实现中，客户端本地 Rust 后端保存后台地址、会话 token 和用户信息；供应商 Key 只保存在 Rust 进程内存，不写入本地 SQLite。后续如要进一步提升本机安全边界，可把 token 迁移到系统安全存储。

### 2. 启动 Bootstrap

桌面端启动后调用：

```text
GET /api/client/bootstrap
```

返回：

- 当前用户信息。
- 用户状态。
- 设备状态。
- 可用模型列表。
- 默认业务模型。
- 是否允许用户修改模型选择。
- 是否允许用户自定义提示词。
- 是否允许本地导入/导出配置。
- 供应商 Key 是否可拉取。
- 后台公告或强制升级策略。

### 3. 本地数据用户隔离

即使不做团队，也要避免同一台电脑上多个账号互相看到数据。

建议本地项目查询增加用户过滤：

- `cloud_user_id`
- 或本地 `local_user_id`

用户切换时，只展示当前登录用户的数据。

### 4. 本地 Key 设置下线

当前设置页中的供应商凭证配置需要调整：

- 普通用户不可编辑供应商 Key。
- 页面显示“模型服务由后台统一配置”。
- 本地 `provider_credentials` 只作为迁移兼容，不再作为长期配置来源。
- 客户端从后台拉取 Key 后，只应放在内存或系统安全存储中，不应写入普通 SQLite 明文字段。

### 5. 同步队列

当前实现为保存或变更时 best-effort 上报：项目保存、提示词变更、模型偏好变更、模型调用日志写入时都会尝试同步到后台。由于已确认离线不可用，断网时路由和 Bootstrap 会阻断核心使用。

后续如果需要更强的补偿能力，可以新增本地同步队列，用于保证项目、提示词、模型偏好和调用日志尽量上报完整。

本地表：`cloud_sync_queue`

```text
id
user_id
entity_type
entity_id
operation
payload_json
status
retry_count
last_error
created_at
updated_at
```

同步对象：

- 完整项目结构数据。
- 全量提示词配置。
- 业务模型偏好。
- 调用日志。

## 云端 API 草案

### 认证

```text
POST /api/auth/login
POST /api/auth/logout
GET  /api/me
```

### 客户端

```text
GET  /api/client/bootstrap
GET  /api/client/provider-credentials
POST /api/client/projects/sync
POST /api/client/prompts/sync
POST /api/client/model-preferences/sync
POST /api/client/model-call-logs
POST /api/client/device/heartbeat
```

### 后台管理

```text
GET  /api/admin/users
POST /api/admin/users
GET  /api/admin/users/:id
PATCH /api/admin/users/:id/status
GET  /api/admin/users/:id/devices
PATCH /api/admin/devices/:id/status

GET  /api/admin/users/:id/projects
GET  /api/admin/users/:id/projects/:projectId
GET  /api/admin/users/:id/prompts
GET  /api/admin/users/:id/model-preferences

GET  /api/admin/model-providers
PUT  /api/admin/model-providers/:id
PUT  /api/admin/model-providers/:id/credentials

GET  /api/admin/model-call-logs
GET  /api/admin/model-call-logs/:id
GET  /api/admin/audit-logs
```

## 实施顺序

### M1：后台基础与账号设备

- 建立 NuxtJS + Naive UI + SQLite 后台项目。
- 实现用户登录、Token 刷新、用户状态。
- 桌面端新增登录页。
- 增加设备注册和心跳。
- 后台可禁用用户或设备。

### M2：统一 Key 管理与下发

- 后台新增供应商配置和 Key 加密存储。
- 后台维护全局供应商 Key。
- 桌面端隐藏或禁用本地 Key 设置。
- 桌面端通过后台拉取 Key 后继续直连供应商。
- 供应商 Key 拉取写入审计日志。

### M3：项目全量同步

- 本地项目增加云端映射字段。
- 桌面端创建/修改项目时同步完整项目结构。
- 后台可以按用户查看项目列表和项目详情。
- 生成结果媒体文件不上传后台，只同步引用、参数、状态和错误信息。

### M4：提示词与模型偏好同步

- 同步用户全量提示词。
- 同步用户业务模型选择。
- 后台可以查看每个用户的 Prompt 和模型偏好。
- 后台提供默认模型，用户可覆盖。

### M5：调用日志、审计和统计

- 客户端上报完整模型调用日志。
- 补充管理员操作审计日志。
- 增加用量统计。
- 增加强制升级、功能开关、导入导出权限等管控项。

## 关键风险

- 模型调用由客户端直连供应商，后台必须把 Key 下发到客户端；这无法达到服务端模型网关的强保密和强审计级别。
- 完整日志依赖客户端上报，不能像服务端网关一样天然保证无遗漏。
- 本地多账号切换必须做数据隔离，否则会出现用户数据串读。
- 项目全量同步不包含生成媒体文件，后台无法直接播放只存在用户本机的图片/视频。
- Key 加密、日志脱敏和审计必须作为后台基础能力，不应后补。
- 完整保留 Prompt、响应和错误信息会带来隐私、安全和 SQLite 体积压力，需要设置日志容量阈值和归档策略。

## 推荐结论

第一阶段优先建设个人用户后台、设备管理、统一 Key 下发、项目全量同步、提示词全量同步、模型偏好同步和调用日志。保持桌面端重客户端定位，不上传生成媒体文件。

这样可以最快满足后台可视化管控诉求，同时避免对现有 Tauri/Vue/Rust 本地架构做高风险重写。
