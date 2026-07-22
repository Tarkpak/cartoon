type DisplayLabels = Readonly<Record<string, string>>

function resolveLabel(value: unknown, labels: DisplayLabels, fallback = '-'): string {
  if (value === null || value === undefined || value === '') return fallback
  const raw = String(value).trim()
  if (!raw) return fallback
  return labels[raw] || labels[raw.toLowerCase()] || raw
}

export const MODEL_OPERATION_LABELS: DisplayLabels = {
  generateText: '文本生成',
  generatetext: '文本生成',
  generateJSON: '结构化数据生成',
  generatejson: '结构化数据生成',
  generateImage: '图片生成',
  generateimage: '图片生成',
  generateVideo: '视频生成',
  generatevideo: '视频生成',
  textToSpeech: '语音合成',
  texttospeech: '语音合成',
  speechToText: '语音识别',
  speechtotext: '语音识别'
}

export const STATUS_LABELS: DisplayLabels = {
  success: '成功',
  succeeded: '成功',
  error: '失败',
  failed: '失败',
  active: '已启用',
  disabled: '已禁用',
  pending: '待处理',
  processing: '处理中',
  generating: '生成中',
  syncing: '同步中',
  running: '进行中',
  in_progress: '进行中',
  completed: '已完成',
  done: '已完成',
  task: '任务已提交',
  status: '状态查询',
  idle: '待命',
  testing: '测试中',
  ready: '可预览',
  video_ready: '视频已就绪',
  skipped: '已跳过',
  synced: '已同步',
  draft: '草稿',
  published: '已发布',
  cancelled: '已取消',
  canceled: '已取消',
  expired: '已过期',
  unknown: '未知'
}

const PROVIDER_LABELS: DisplayLabels = {
  custom_openai: '自定义 OpenAI',
  openai: 'OpenAI',
  gemini: 'Gemini',
  qwen: '通义千问',
  volcengine: '火山方舟',
  deepseek: 'DeepSeek',
  kling: '可灵'
}

const MEDIA_TYPE_LABELS: DisplayLabels = {
  image: '图片',
  audio: '音频',
  video: '视频',
  binary: '二进制内容',
  file: '文件',
  directory: '文件夹'
}

const MEDIA_DIRECTION_LABELS: DisplayLabels = {
  request: '请求',
  response: '响应'
}

const LOG_LEVEL_LABELS: DisplayLabels = {
  debug: '调试',
  info: '信息',
  warn: '警告',
  warning: '警告',
  error: '错误'
}

const LOG_SOURCE_LABELS: DisplayLabels = {
  backend: '后端',
  frontend: '客户端'
}

const LOG_CATEGORY_LABELS: DisplayLabels = {
  http_request: 'HTTP 请求',
  event: '事件',
  model: '模型调用',
  network: '网络',
  runtime: '运行时',
  storage: '存储',
  sync: '同步'
}

const USER_ROLE_LABELS: DisplayLabels = {
  admin: '管理员',
  user: '普通用户',
  assistant: '助手',
  system: '系统'
}

const CLIENT_CHANNEL_LABELS: DisplayLabels = {
  stable: '稳定版',
  beta: '测试版',
  alpha: '内测版'
}

const CLIENT_PLATFORM_LABELS: DisplayLabels = {
  all: '全部平台',
  macos: 'macOS',
  windows: 'Windows',
  linux: 'Linux'
}

const CLIENT_ARCH_LABELS: DisplayLabels = {
  all: '全部架构',
  aarch64: 'Apple Silicon / ARM64',
  arm64: 'Apple Silicon / ARM64',
  x86_64: 'x86_64',
  x64: 'x86_64'
}

const CREDIT_TRANSACTION_TYPE_LABELS: DisplayLabels = {
  admin_add: '管理员增加',
  admin_deduct: '管理员减少',
  model_call: '模型调用'
}

const AUDIT_ACTION_LABELS: DisplayLabels = {
  'setup.initialize_admin': '初始化管理员',
  'auth.login': '用户登录',
  'auth.logout': '用户退出',
  'admin.users.create': '创建用户',
  'admin.users.update': '更新用户',
  'admin.users.status': '更新用户状态',
  'admin.users.reset_password': '重置用户密码',
  'admin.credits.add': '增加用户积分',
  'admin.credits.deduct': '减少用户积分',
  'admin.devices.status': '更新设备状态',
  'admin.devices.delete': '删除设备',
  'admin.settings.update': '更新系统设置',
  'admin.credit_rules.create': '创建积分规则',
  'admin.credit_rules.update': '更新积分规则',
  'admin.credit_rules.delete': '删除积分规则',
  'admin.model_providers.create': '创建模型供应商',
  'admin.model_providers.update': '更新模型供应商',
  'admin.model_providers.delete': '删除模型供应商',
  'admin.model_providers.export': '导出模型供应商',
  'admin.model_providers.import': '导入模型供应商',
  'admin.model_providers.credentials.update': '更新供应商凭据',
  'admin.model_providers.models.update': '更新供应商模型',
  'admin.model_providers.models.sync': '同步供应商模型',
  'admin.model_call_logs.view': '查看模型调用日志',
  'admin.client_versions.create': '创建客户端版本',
  'admin.client_versions.update': '更新客户端版本',
  'admin.client_versions.sync_updater': '同步客户端更新器',
  'admin.tos_files.list': '查看云存储文件',
  'admin.tos_files.download': '下载云存储文件',
  'admin.tos_storage.update': '更新云存储配置',
  'admin.wx_channels.update': '更新视频号配置',
  'client.provider_credentials.fetch': '客户端获取供应商凭据',
  'client.tos_storage.fetch': '客户端获取云存储配置',
  'client.wx_channels.fetch': '客户端获取视频号配置'
}

const AUDIT_TARGET_TYPE_LABELS: DisplayLabels = {
  user: '用户',
  device: '设备',
  app_settings: '系统设置',
  credit_rule: '积分规则',
  credit_rules: '积分规则',
  model_provider: '模型供应商',
  model_call_log: '模型调用日志',
  provider_credentials: '供应商凭据',
  client_version: '客户端版本',
  tos_storage_file: '云存储文件',
  tos_storage_config: '云存储配置',
  wx_channels_config: '视频号配置'
}

export const modelOperationLabel = (value: unknown) => resolveLabel(value, MODEL_OPERATION_LABELS)
export const modelStatusLabel = (value: unknown) => resolveLabel(value, STATUS_LABELS)
export const statusLabel = (value: unknown) => resolveLabel(value, STATUS_LABELS)
export const providerLabel = (value: unknown) => resolveLabel(value, PROVIDER_LABELS)
export const mediaTypeLabel = (value: unknown) => resolveLabel(value, MEDIA_TYPE_LABELS)
export const mediaDirectionLabel = (value: unknown) => resolveLabel(value, MEDIA_DIRECTION_LABELS)
export const mediaStatusLabel = (value: unknown) => resolveLabel(value, STATUS_LABELS)
export const logLevelLabel = (value: unknown) => resolveLabel(value, LOG_LEVEL_LABELS)
export const logSourceLabel = (value: unknown) => resolveLabel(value, LOG_SOURCE_LABELS)
export const logCategoryLabel = (value: unknown) => resolveLabel(value, LOG_CATEGORY_LABELS)
export const userRoleLabel = (value: unknown) => resolveLabel(value, USER_ROLE_LABELS)
export const userStatusLabel = (value: unknown) => resolveLabel(value, STATUS_LABELS)
export const clientChannelLabel = (value: unknown) => resolveLabel(value, CLIENT_CHANNEL_LABELS)
export const clientPlatformLabel = (value: unknown) => resolveLabel(value, CLIENT_PLATFORM_LABELS)
export const clientArchLabel = (value: unknown) => resolveLabel(value, CLIENT_ARCH_LABELS)
export const creditTransactionTypeLabel = (value: unknown) => resolveLabel(value, CREDIT_TRANSACTION_TYPE_LABELS)
export const auditActionLabel = (value: unknown) => resolveLabel(value, AUDIT_ACTION_LABELS)
export const auditTargetTypeLabel = (value: unknown) => resolveLabel(value, AUDIT_TARGET_TYPE_LABELS)
