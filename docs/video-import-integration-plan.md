# 视频导入原生实现方案

## 方案概述

将 `recognize-video` 的能力沉淀为 Playlet 主项目的原生“视频导入”模块，形成完整闭环：

```text
视频输入 -> 提取音频 -> Bcut ASR 识别 -> 字幕编辑 -> AI 生成可解析剧本 -> 导入工作台 -> 生成新视频
```

`recognize-video` 作为已验证的原型和实现参考，不作为主项目运行时依赖。主项目内使用 Rust 后端原生实现任务编排、媒体处理、ASR 调用、剧本生成和项目导入，避免桌面打包时依赖 Bun 子进程、Node 模块路径和额外运行时。

核心价值：

- 从现有短剧视频快速提取字幕和剧本草稿。
- 让用户在导入前编辑字幕和剧本，降低 ASR 与模型误差。
- 复用现有模型配置、脚本解析和资产工作台能力。
- 形成“分析现有视频 -> 结构化剧本 -> 项目创作 -> 生成新视频”的闭环。

## 实现原则

1. 主项目原生实现，不在生产流程中调用 `recognize-video` CLI。
2. 当前默认 ASR 使用可用的 Bcut ASR 链路，并保留 provider 抽象，后续可接火山引擎、Qwen 等 ASR。
3. 不在本方案中承诺性能指标，先保证流程可靠、状态可恢复、数据可审计。
4. 剧本导入工作台不直接信任生成文本，必须经过用户确认和现有脚本解析流程。
5. 前端路由、组件和 API 命名贴合现有项目结构，导入成功后进入现有资产工作台或项目详情。

## 系统架构

```text
Vue 前端
  app/pages/import/video.vue
  app/components/video-import/
  app/composables/useVideoImport.ts

        HTTP / SSE 或 WebSocket

Rust 后端 (Axum + Tokio)
  src-tauri/src/backend/video_import/
    mod.rs
    task_service.rs
    media_processor.rs
    asr/
      mod.rs
      bcut.rs
      types.rs
    script_generator.rs
    import_service.rs

        本地文件 / SQLite / 外部服务

ffmpeg
Bcut ASR
现有文本模型 provider 配置
现有 /api/script/parse 能力
现有项目与资产工作台数据结构
```

模块职责：

- `task_service.rs`：任务创建、状态流转、重试、取消、事件推送。
- `media_processor.rs`：调用 ffmpeg 提取音频，检查输入文件和输出 artifact。
- `asr/bcut.rs`：实现 Bcut ASR 上传、创建任务、轮询结果、格式化字幕。
- `script_generator.rs`：基于字幕生成“可被现有脚本解析器消费”的剧本文本。
- `import_service.rs`：调用或复用现有脚本解析逻辑，生成项目草稿并关联导入任务。

## 数据模型

### video_import_tasks

记录用户一次视频导入任务的主状态。

```sql
CREATE TABLE video_import_tasks (
  id TEXT PRIMARY KEY,
  original_filename TEXT NOT NULL,
  source_kind TEXT NOT NULL DEFAULT 'upload',
  source_path TEXT NOT NULL,

  status TEXT NOT NULL DEFAULT 'pending',
  current_step TEXT NOT NULL DEFAULT 'created',
  progress INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,

  asr_provider TEXT NOT NULL DEFAULT 'bcut',
  script_model_id TEXT,
  config_json TEXT NOT NULL DEFAULT '{}',
  metadata_json TEXT NOT NULL DEFAULT '{}',

  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT,
  cancelled_at TEXT
);

CREATE INDEX idx_video_import_tasks_status ON video_import_tasks(status);
CREATE INDEX idx_video_import_tasks_created ON video_import_tasks(created_at);
CREATE INDEX idx_video_import_tasks_updated ON video_import_tasks(updated_at);
```

建议状态：

```text
pending -> extracting -> transcribing -> subtitle_ready -> generating_script -> script_ready -> importing -> imported
       \-> failed
       \-> cancelled
```

`subtitle_ready` 和 `script_ready` 是有意保留的人工确认节点。用户可以编辑字幕或剧本后继续下一步。

### video_import_artifacts

记录每一步产生的文件和可审计内容。

```sql
CREATE TABLE video_import_artifacts (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  path TEXT NOT NULL,
  mime_type TEXT,
  size_bytes INTEGER,
  sha256 TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  FOREIGN KEY (task_id) REFERENCES video_import_tasks(id) ON DELETE CASCADE
);

CREATE INDEX idx_video_import_artifacts_task ON video_import_artifacts(task_id);
CREATE INDEX idx_video_import_artifacts_kind ON video_import_artifacts(kind);
```

`kind` 建议值：

```text
source_video
extracted_audio
asr_raw_json
subtitle_txt
subtitle_srt
script_draft
script_edited
parse_result
queue_report
log
```

### video_import_step_runs

记录步骤执行历史，支持重试和问题排查。

```sql
CREATE TABLE video_import_step_runs (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  step TEXT NOT NULL,
  attempt INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  duration_ms INTEGER,
  provider TEXT,
  external_task_id TEXT,
  error_message TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  FOREIGN KEY (task_id) REFERENCES video_import_tasks(id) ON DELETE CASCADE
);

CREATE INDEX idx_video_import_step_runs_task ON video_import_step_runs(task_id);
CREATE INDEX idx_video_import_step_runs_step ON video_import_step_runs(step);
```

### video_import_projects

记录导入任务与主项目的关系。

```sql
CREATE TABLE video_import_projects (
  import_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  imported_at TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  FOREIGN KEY (import_id) REFERENCES video_import_tasks(id) ON DELETE CASCADE,
  PRIMARY KEY (import_id, project_id)
);
```

## 数据流转

### 1. 创建任务

```text
用户上传/选择视频
  -> POST /api/import/video/upload
  -> 保存 source_video artifact
  -> 创建 video_import_tasks
  -> 后台进入 extracting
```

首版只做普通上传或本地路径选择，不做断点续传。断点续传可在批量和大文件稳定后再补。

### 2. 提取音频

```text
extracting
  -> ffmpeg 提取 16kHz mono 音频
  -> 保存 extracted_audio artifact
  -> 写入 step run
  -> 进入 transcribing
```

ffmpeg 路径优先复用现有桌面 ffmpeg 能力；找不到时返回明确错误，引导用户安装或配置。

### 3. Bcut ASR

```text
transcribing
  -> 上传音频到 Bcut ASR
  -> 创建外部 ASR task
  -> 轮询结果
  -> 保存 asr_raw_json / subtitle_txt / subtitle_srt
  -> 进入 subtitle_ready
```

Bcut ASR 是当前默认 provider。后端接口内部使用统一抽象：

```rust
pub trait AsrProvider {
    async fn transcribe(&self, input: AsrInput) -> Result<AsrOutput, ApiError>;
}
```

`AsrOutput` 至少包含：

- 原始响应 JSON。
- 分段文本和时间戳。
- 纯文本字幕。
- SRT 字幕。
- 外部任务 ID。

### 4. 字幕确认与编辑

```text
subtitle_ready
  -> 前端展示字幕 TXT/SRT
  -> 用户可编辑纯文本字幕
  -> POST /api/import/video/tasks/:id/subtitle
  -> 保存 subtitle_txt artifact 新版本
```

首版重点支持纯文本编辑；SRT 可展示和下载，不要求复杂时间轴编辑。

### 5. 生成可解析剧本

```text
用户点击生成剧本
  -> POST /api/import/video/tasks/:id/generate-script
  -> 使用现有文本模型配置
  -> 生成适合 /api/script/parse 的剧本文本
  -> 保存 script_draft artifact
  -> 进入 script_ready
```

生成提示词目标不是最终文学剧本，而是“结构清晰、能被现有脚本解析器稳定解析”的输入稿。建议输出包含：

- 剧名或导入任务标题。
- 角色列表。
- 场景划分。
- 每场剧情描述。
- 对白。
- 可选镜头/情绪/环境信息。

### 6. 剧本确认与导入工作台

```text
script_ready
  -> 前端展示剧本草稿
  -> 用户可编辑
  -> POST /api/import/video/tasks/:id/import
  -> 保存 script_edited artifact
  -> 调用/复用现有脚本解析逻辑
  -> 生成项目草稿
  -> 创建项目关联
  -> 跳转 /projects/:id 或 /asset-workbench?projectId=...
```

导入阶段必须提供解析预览。如果脚本解析结果缺少角色、场景或关键信息，前端应提示用户回到剧本编辑，而不是直接创建质量很差的项目。

## API 设计

### 上传视频并创建任务

```http
POST /api/import/video/upload
Content-Type: multipart/form-data
```

Body：

```text
video: File
config: JSON
```

Response：

```json
{
  "success": true,
  "data": {
    "taskId": "task_xxx"
  }
}
```

### 查询任务列表

```http
GET /api/import/video/tasks?status=subtitle_ready&limit=20&offset=0
```

### 查询任务详情

```http
GET /api/import/video/tasks/:id
```

返回任务、artifact 列表、最近 step runs 和可展示的当前字幕/剧本摘要。

### 更新字幕

```http
PUT /api/import/video/tasks/:id/subtitle
Content-Type: application/json
```

```json
{
  "text": "编辑后的字幕文本"
}
```

### 生成剧本

```http
POST /api/import/video/tasks/:id/generate-script
```

### 更新剧本

```http
PUT /api/import/video/tasks/:id/script
Content-Type: application/json
```

```json
{
  "script": "编辑后的剧本文本"
}
```

### 导入到工作台

```http
POST /api/import/video/tasks/:id/import
```

Response：

```json
{
  "success": true,
  "data": {
    "projectId": "proj_xxx",
    "redirectUrl": "/projects/proj_xxx"
  }
}
```

### 重试任务

```http
POST /api/import/video/tasks/:id/retry
Content-Type: application/json
```

```json
{
  "fromStep": "transcribe"
}
```

允许的 `fromStep`：

```text
extract
transcribe
generate_script
import
```

### 取消任务

```http
POST /api/import/video/tasks/:id/cancel
```

### 事件订阅

优先使用 SSE，协议简单，足够覆盖任务进度推送：

```http
GET /api/import/video/events
```

事件类型：

```text
task.created
task.updated
task.failed
task.cancelled
task.imported
```

如果后续需要双向交互，再升级 WebSocket。

## 前端设计

页面：

```text
app/pages/import/video.vue
```

组件：

```text
app/components/video-import/VideoUploadZone.vue
app/components/video-import/VideoImportTaskList.vue
app/components/video-import/VideoImportTaskDetail.vue
app/components/video-import/SubtitleEditor.vue
app/components/video-import/ScriptEditor.vue
app/components/video-import/ImportPreview.vue
```

Composable：

```typescript
// app/composables/useVideoImport.ts
export function useVideoImport() {
  const tasks = ref<VideoImportTask[]>([])
  const activeTask = ref<VideoImportTaskDetail | null>(null)

  async function uploadVideo(file: File, config: VideoImportConfig)
  async function fetchTasks()
  async function fetchTask(taskId: string)
  async function updateSubtitle(taskId: string, text: string)
  async function generateScript(taskId: string)
  async function updateScript(taskId: string, script: string)
  async function importToProject(taskId: string)
  async function retryTask(taskId: string, fromStep: VideoImportRetryStep)
  async function cancelTask(taskId: string)
  function subscribeEvents()

  return {
    tasks,
    activeTask,
    uploadVideo,
    fetchTasks,
    fetchTask,
    updateSubtitle,
    generateScript,
    updateScript,
    importToProject,
    retryTask,
    cancelTask,
    subscribeEvents,
  }
}
```

交互流程：

1. 用户进入“视频导入”页面，上传视频。
2. 任务卡片显示提取音频、ASR、字幕确认、剧本生成、导入状态。
3. ASR 完成后进入字幕编辑视图。
4. 用户确认字幕后生成剧本。
5. 用户确认剧本后预览解析结果。
6. 用户确认导入，创建项目并跳转到 `/projects/:id` 或资产工作台。

## 与现有能力的复用点

- 模型选择：复用现有 workflow text model 配置，不单独维护导入模块模型配置。
- 提示词：新增“视频导入剧本生成”提示词模板，纳入现有提示词管理。
- 脚本解析：导入工作台阶段复用现有 `/api/script/parse` 或其内部函数。
- 项目创建：复用现有项目创建、序列化和资产工作台数据结构。
- 文件服务：复用现有本地 public 文件服务和 TOS 上传能力，首版优先本地。
- 日志：复用现有模型日志/应用日志，避免新增一套不可检索日志体系。

## 安全与稳定性

文件上传：

- 限制视频类型：`mp4`、`mov`、`mkv`、`avi`、`webm`。
- 限制文件大小，默认配置可调。
- 所有落盘路径由后端生成，禁止信任用户文件名作为路径。
- 保存原文件名仅用于展示。

ASR 与模型调用：

- 不在日志中输出完整请求凭证。
- 外部 task id 可记录，方便排查。
- ASR 原始响应保存为 artifact，便于重跑格式化逻辑。

任务恢复：

- 每个步骤写入 `video_import_step_runs`。
- 已存在 artifact 且 hash 匹配时可跳过重复步骤。
- 重试从指定步骤开始，并保留旧 artifact。

清理策略：

- 提供后台清理命令或 API，按任务状态和创建时间清理临时文件。
- 已导入项目的 source video/audio 可配置保留或删除。

## 实施计划

### Phase 1：任务与媒体基础

- 新增数据库表和 schema 初始化。
- 新增 `video_import` Rust 模块。
- 实现视频上传、任务创建、任务列表和任务详情。
- 实现 ffmpeg 音频提取和 artifact 记录。
- 前端完成上传区、任务列表、任务详情基础 UI。

验收：上传视频后可创建任务，提取音频成功，任务状态和 artifact 可查询。

### Phase 2：Bcut ASR 与字幕确认

- 实现 Bcut ASR provider。
- 保存原始 ASR JSON、TXT、SRT artifact。
- 实现字幕编辑和保存。
- 实现任务事件推送。

验收：视频可自动进入 `subtitle_ready`，用户可以查看和编辑字幕。

### Phase 3：剧本生成与编辑

- 新增视频导入剧本生成提示词模板。
- 复用现有文本模型配置生成剧本草稿。
- 实现剧本编辑和版本 artifact 保存。
- 增加失败重试和错误展示。

验收：用户确认字幕后可生成可编辑剧本，失败后可从剧本生成步骤重试。

### Phase 4：导入工作台

- 复用现有脚本解析逻辑生成结构化结果。
- 前端展示解析预览。
- 用户确认后创建项目并写入 `video_import_projects`。
- 导入成功后跳转项目详情或资产工作台。

验收：用户可以从视频生成一个可继续编辑和生成资产的项目。

### Phase 5：批量与维护能力

- 支持批量上传和队列顺序处理。
- 支持任务取消、清理历史、按状态筛选。
- 补齐单元测试和关键集成测试。
- 文档补充使用说明和故障排查。

验收：多个视频可稳定排队处理，失败任务可定位原因并重试。

## 验收标准

功能完整性：

- 支持视频上传和任务管理。
- 支持 ffmpeg 提取音频。
- 支持 Bcut ASR 生成字幕。
- 支持字幕编辑。
- 支持 AI 生成可解析剧本。
- 支持剧本编辑。
- 支持预览解析结果并导入到项目。
- 支持失败重试和任务取消。

代码质量：

- Rust 后端核心逻辑有单元测试。
- 前端 composable 和关键编辑逻辑有 Vitest 覆盖。
- API 错误返回结构统一。
- 不引入 Bun CLI 作为主项目运行时依赖。

## 相关参考

- `recognize-video` 历史原型已迁移为主项目原生实现，原型目录不再作为运行时或源码依赖保留。
- [主项目架构说明](../CLAUDE.md)
