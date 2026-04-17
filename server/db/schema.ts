import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core'

// ==================== 项目表 ====================

export const projects = sqliteTable('projects', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  workflowType: text('workflow_type', { enum: ['asset_consistency'] }).notNull().default('asset_consistency'),
  // 项目预设配置 (必填)
  styleId: text('style_id').notNull(), // 风格预设 ID
  aspectRatio: text('aspect_ratio', { enum: ['16:9', '9:16', '1:1'] }).notNull().default('16:9'), // 视频比例
  status: text('status', { enum: ['draft', 'in_progress', 'completed'] }).default('draft'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull()
})

// ==================== 剧本表 ====================

export const scripts = sqliteTable('scripts', {
  id: text('id').primaryKey(),
  projectId: text('project_id').references(() => projects.id, { onDelete: 'cascade' }),
  title: text('title'),
  rawText: text('raw_text').notNull(),
  parsedData: text('parsed_data'), // JSON 存储 ParsedScript
  totalDuration: integer('total_duration').default(0),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull()
})

// ==================== 场景表 ====================

export const scenes = sqliteTable('scenes', {
  id: text('id').primaryKey(),
  scriptId: text('script_id').references(() => scripts.id, { onDelete: 'cascade' }),
  orderIndex: integer('order_index').notNull(),
  title: text('title'),
  description: text('description').notNull(),
  setting: text('setting'), // JSON 存储 SceneSetting
  characters: text('characters'), // JSON 存储 SceneCharacter[]
  dialogues: text('dialogues'), // JSON 存储 Dialogue[]
  duration: integer('duration').default(8),
  narration: text('narration'),
  // 镜头语言
  shotType: text('shot_type'), // 景别
  cameraMovement: text('camera_movement'), // 运镜方式
  cameraNote: text('camera_note'), // 镜头备注
  // 转场
  transitionIn: text('transition_in'), // 入场转场
  transitionOut: text('transition_out'), // 出场转场
  transitionDuration: real('transition_duration'), // 转场时长
  // 帧和视频
  firstFrame: text('first_frame'), // base64 或文件路径
  lastFrame: text('last_frame'), // base64 或文件路径
  videoUrl: text('video_url'), // 视频 URL 路径
  status: text('status', { enum: ['pending', 'frames_ready', 'video_ready'] }).default('pending'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull()
})

// ==================== 角色表 ====================

export const characters = sqliteTable('characters', {
  id: text('id').primaryKey(),
  projectId: text('project_id').references(() => projects.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  role: text('role', { enum: ['protagonist', 'antagonist', 'supporting', 'extra'] }),
  appearance: text('appearance').notNull(),
  personality: text('personality'),
  traits: text('traits'), // JSON 存储 string[]
  background: text('background'),
  motivation: text('motivation'),
  speakingStyle: text('speaking_style'),
  catchphrase: text('catchphrase'),
  voiceTone: text('voice_tone'),
  age: integer('age'),
  gender: text('gender', { enum: ['male', 'female', 'other'] }),
  baseImage: text('base_image'), // base64 或文件路径
  expressions: text('expressions'), // JSON 存储 Record<Emotion, string>
  views: text('views'), // JSON 存储多视角图像 Record<CharacterView, string>
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull()
})

// ==================== 视频任务表 ====================

export const videoTasks = sqliteTable('video_tasks', {
  id: text('id').primaryKey(),
  sceneId: text('scene_id'), // 移除外键约束，允许临时场景ID
  status: text('status', { enum: ['pending', 'processing', 'completed', 'failed'] }).default('pending'),
  progress: integer('progress').default(0),
  config: text('config'), // JSON 存储 VideoGenerationConfig
  videoData: text('video_data'), // base64 或文件路径
  audioData: text('audio_data'), // base64 或文件路径
  metadata: text('metadata'), // JSON 存储 VideoMetadata
  error: text('error'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull()
})

// ==================== 生成的视频表 ====================

export const generatedVideos = sqliteTable('generated_videos', {
  id: text('id').primaryKey(),
  sceneId: text('scene_id').references(() => scenes.id, { onDelete: 'cascade' }),
  taskId: text('task_id').references(() => videoTasks.id),
  videoPath: text('video_path'), // 视频文件路径
  audioPath: text('audio_path'), // 音频文件路径
  duration: real('duration'),
  resolution: text('resolution'),
  aspectRatio: text('aspect_ratio'),
  fps: integer('fps').default(24),
  hasAudio: integer('has_audio', { mode: 'boolean' }).default(true),
  fileSize: integer('file_size'),
  createdAt: text('created_at').notNull()
})

// ==================== 系统配置表 ====================

export const systemConfig = sqliteTable('system_config', {
  key: text('key').primaryKey(),
  value: text('value').notNull(), // JSON 存储
  updatedAt: text('updated_at').notNull()
})

// ==================== 模型调试日志表 ====================

export const modelDebugLogs = sqliteTable('model_debug_logs', {
  id: text('id').primaryKey(),
  timestamp: text('timestamp').notNull(),
  provider: text('provider').notNull(),
  model: text('model').notNull(),
  operation: text('operation').notNull(),
  status: text('status', { enum: ['success', 'error'] }).notNull(),
  durationMs: integer('duration_ms').notNull(),
  requestJson: text('request_json'),
  responseJson: text('response_json'),
  errorJson: text('error_json'),
  createdAt: text('created_at').notNull()
})

// ==================== 类型导出 ====================

export type SystemConfig = typeof systemConfig.$inferSelect
export type NewSystemConfig = typeof systemConfig.$inferInsert

export type Project = typeof projects.$inferSelect
export type NewProject = typeof projects.$inferInsert

export type Script = typeof scripts.$inferSelect
export type NewScript = typeof scripts.$inferInsert

export type Scene = typeof scenes.$inferSelect
export type NewScene = typeof scenes.$inferInsert

export type Character = typeof characters.$inferSelect
export type NewCharacter = typeof characters.$inferInsert

export type VideoTask = typeof videoTasks.$inferSelect
export type NewVideoTask = typeof videoTasks.$inferInsert

export type GeneratedVideo = typeof generatedVideos.$inferSelect
export type NewGeneratedVideo = typeof generatedVideos.$inferInsert

export type ModelDebugLog = typeof modelDebugLogs.$inferSelect
export type NewModelDebugLog = typeof modelDebugLogs.$inferInsert
