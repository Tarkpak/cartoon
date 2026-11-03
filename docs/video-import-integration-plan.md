# 视频转项目

把现有短剧视频（单集文件或整部剧文件夹）转换成资产工作台项目：

```text
视频 -> 识别字幕 -> 校对字幕 -> 生成并校对剧本 -> 创建项目 -> 资产工作台
```

全部在 Rust 后端原生实现（`src-tauri/src/backend/video_import.rs`），不依赖外部 CLI。字幕识别使用 Bcut ASR，剧本生成和解析复用工作流文本模型配置与 `/api/script/parse` 的内部实现。

## 设计原则

1. **耗时步骤一律后台执行**：识别、生成剧本、解析建项目都在后台作业中运行，接口只做校验和状态认领后立即返回，前端轮询任务详情。关闭页面不会中断任务。
2. **两个人工确认点**：`subtitle_ready`（校对字幕）和 `script_ready`（校对剧本）。模型输出不直接进项目。
3. **任何失败都能从原步骤继续**：失败或取消时保留所在步骤（`current_step`），已完成步骤的产物都保留，重试从中断处开始。
4. **操作幂等、不并发**：每个任务同一时刻最多一个后台作业；状态迁移都是带条件的原子更新；同一任务只会创建一个项目。

## 状态机

```text
pending -> extracting -> transcribing -> subtitle_ready
        -> generating_script -> script_ready
        -> importing -> imported
任意运行态 -> failed | cancelled（保留 current_step）
failed | cancelled -> 从 current_step 对应的步骤重试
```

| 状态 | current_step | 含义 |
| --- | --- | --- |
| `pending` | `queued` | 排队等待识别（同时最多 2 个识别作业） |
| `extracting` | `copy_source` / `extract` | 准备源视频 / ffmpeg 抽取 16kHz 单声道音频 |
| `transcribing` | `transcribe` | Bcut ASR（全局最多 2 个并发） |
| `subtitle_ready` | `subtitle_ready` | 等待校对字幕 |
| `generating_script` | `generate_script` | 生成剧本 |
| `script_ready` | `script_ready` | 等待校对剧本 |
| `importing` | `import` | 解析剧本并创建项目 |
| `imported` | `imported` | 完成，`video_import_projects` 记录项目 ID |

剧集组任务（`is_series_group = 1`）在识别阶段的状态由分集推导：有分集在识别时显示 `transcribing`，全部完成后为 `subtitle_ready`，有失败分集时为 `failed`（`current_step = transcribe`，重试只重跑失败或取消的分集）。生成剧本、创建项目、取消这三个阶段由组任务自己维护。

### 启动恢复

应用启动时（`resume_video_import_tasks`）：

- 处于识别阶段的任务自动重新排队续跑，已抽取的音频会复用。
- 处于 `generating_script` / `importing` 的任务标记为失败（“应用退出导致处理中断，请重试”），由用户决定是否重试，避免意外重复消耗模型调用。
- 所有未结束的 step run 关闭为失败。

### 取消

取消会直接中止正在运行的后台作业（不只是在步骤之间检查），并清理创建到一半的空项目。剧集取消只影响正在运行的分集，已识别完成的分集不受影响。

## 各步骤要点

**创建任务**
- 单集：`POST /api/import/video/upload`，上传时流式写盘并计算哈希。
- 整部剧：`POST /api/import/video/preview-series` 预检文件夹（集数、时长，多数视频短于 60 秒时推荐“连续片段”模式），`POST /api/import/video/upload-series` 在一个事务里创建组任务和分集任务。源视频在后台作业中硬链接（跨盘时复制）到任务目录，请求本身不做文件复制。

**校对字幕**
- 单集直接保存新版本字幕。
- 剧集展示为按 `## 第N集：标题` 拼接的整体字幕，保存时按标题拆回各分集，只给内容有变化的分集写新版本。

**生成剧本**
- `POST /tasks/:id/generate-script`，body `{ force?: boolean }`，默认 `true`。
- 单集：一次生成。
- 剧集（按集）：先用完整字幕生成全局剧情档案（角色编号、称呼、主线），再并发（3 路）逐集生成，每集生成完立即落盘。`force = true` 时全部重新生成，保证各集共用同一份档案；失败后重试（`force = false`）复用已生成的分集。
- 剧集（连续片段）：按字数和集数切块，每块附带相邻块的边界字幕，校验每块输出包含预期的全部片段。
- 每次生成都产生新的产物文件，历史版本保留。读取时剧本草稿和编辑稿按时间取最新，重新生成不会被旧编辑稿挡住。
- 字幕在剧本生成后又被修改时，详情接口返回 `scriptOutdated: true`，界面提示重新生成。

**创建项目**
- `POST /tasks/:id/import`，body `{ projectTitle?, styleId?, aspectRatio?, scriptParseMode? }`。选项会写回任务配置，失败重试沿用。
- 在创建项目前先准备好每一集的解析输入（剧集按集号匹配剧本段落，缺内容时直接报错）。
- 每个解析单元（单集或剧集的每一集）的解析结果按「剧本内容 + 解析模式 + 画风 + 分集计划」的哈希缓存在任务目录；重试时已解析的集直接复用，并发 3 路解析其余部分。
- 解析结果没有场景时报错，提示编辑剧本后重试。
- 失败或取消时删除本次创建的空项目。已导入的任务再次调用直接返回已有项目。
- 没有单独的“解析预览”步骤：解析依赖项目权限，且解析结果需要在资产工作台中继续编辑，因此项目创建完成后直接进入工作台检查和修改。

## API

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/import/video/upload` | 上传单集（multipart：`video`、`config`） |
| POST | `/api/import/video/preview-series` | 预检剧集文件夹 |
| POST | `/api/import/video/upload-series` | 导入剧集文件夹 |
| GET | `/api/import/video/tasks` | 任务列表，`status` 支持具体状态，以及 `running`（全部运行态）、`waiting`（待校对） |
| GET | `/api/import/video/tasks/:id` | 任务详情：任务、分集、字幕、剧本、`scriptOutdated`、`projectId`、`jobRunning`、step runs、产物 |
| PUT | `/api/import/video/tasks/:id/subtitle` | 保存字幕，返回 `updatedEpisodes` |
| PUT | `/api/import/video/tasks/:id/script` | 保存剧本（失败/取消后保存剧本会回到 `script_ready`） |
| POST | `/api/import/video/tasks/:id/generate-script` | 后台生成剧本 |
| POST | `/api/import/video/tasks/:id/import` | 后台创建项目 |
| POST | `/api/import/video/tasks/:id/retry` | `fromStep`：`extract` / `transcribe` / `generate_script` / `import` |
| POST | `/api/import/video/tasks/:id/cancel` | 取消运行中的步骤 |
| DELETE | `/api/import/video/tasks/:id` | 删除任务（剧集连同分集），已创建的项目不受影响 |
| POST | `/api/import/video/tasks/batch-delete` | 批量删除 |

状态不允许时返回 409，并在消息中说明当前状态。

## 数据

- `video_import_tasks`：任务主状态，`config_json` 存导入选项，`metadata_json` 存 `originalPath`（剧集源文件）和 `pendingProjectId`（创建中的项目，用于失败清理）。
- `video_import_artifacts`：每一步的产物（源视频、音频、ASR 原始结果、字幕 TXT/SRT、剧本草稿/编辑稿、解析结果），带大小和 SHA-256。
- `video_import_step_runs`：每一步的执行记录，含重试次数、耗时、外部任务 ID、错误信息。
- `video_import_projects`：任务与项目的关联。

## 前端

- `app/lib/video-import-workflow.ts`：状态文案、阶段推导、恢复动作、可执行操作（`resolveVideoImportActions`）等纯函数，页面只读取推导结果。
- `app/composables/useVideoImport.ts`：接口调用。
- `app/pages/import/video.vue`：导入入口与任务列表（按进行中 / 待校对 / 已完成 / 失败 / 已取消筛选，每行显示下一步提示）。
- `app/pages/import/video-detail.vue`：四步进度条、状态横幅（进度 / 失败原因与继续按钮 / 打开项目 / 字幕变更提示）、剧集分集栏（含单集重试）、字幕与剧本编辑器、执行记录。运行中每 2 秒轮询；轮询不会覆盖未保存的修改，离开页面前提示未保存内容；在本页发起创建项目时，完成后自动跳转到项目。
- 组件位于 `app/components/video-import/`。
