# Manju - AI漫剧自动化生成系统

> **版本**: 2.0  
> **更新日期**: 2025年12月26日  
> **技术栈**: Nuxt.js 4 + Google Gemini API + 阿里千问 API

---

## 一、项目概述

### 1.1 项目简介

Manju 是一个 AI 驱动的漫剧创作平台，实现从文本到视频的全自动化生成流程。支持首尾帧控制、角色一致性、智能配音，目标是降低漫剧制作门槛和成本。

### 1.2 核心功能

- **故事大纲生成**: 从创意文本生成三幕结构大纲
- **剧本智能解析**: 自动提取场景、角色、对话
- **角色立绘生成**: 4K 高质量立绘 + 多表情/多视角变体
- **分镜脚本生成**: 专业镜头语言设计
- **首尾帧生成**: 场景关键帧图片生成
- **视频生成**: 首尾帧插值生成连贯视频
- **场景串联**: 多场景视频拼接与转场

---

## 二、技术架构

### 2.1 技术栈

| 层级 | 技术选型 | 说明 |
|------|----------|------|
| **全栈框架** | Nuxt.js 4.2.1 | Vue 3 + Nitro Server |
| **语言** | TypeScript | 类型安全 |
| **UI框架** | shadcn-vue + Tailwind CSS | 现代化组件库 |
| **状态管理** | Pinia | Vue 官方推荐 |
| **数据库** | SQLite + Drizzle ORM | 轻量级本地存储 |
| **数据验证** | Zod | 运行时类型校验 |
| **视频处理** | FFmpeg (fluent-ffmpeg) | 视频合成与转场 |
| **图片处理** | Sharp | 图片优化 |

### 2.2 AI 模型

| 用途 | 提供商 | 模型 | 说明 |
|------|--------|------|------|
| **文本生成** | Gemini | gemini-3-flash-preview | 快速文本生成 |
| **文本生成** | 千问 | qwen3.6-plus | 复杂文本任务与深度思考 |
| **图片生成** | Gemini | gemini-3-pro-image-preview | Nano Banana Pro, 4K |
| **图片生成** | 千问 | wan2.6-t2i | 通义万相文生图 |
| **视频生成** | Gemini | veo-3.1-generate-preview | 首尾帧插值, 8秒 |
| **视频生成** | 千问 | wan2.2-kf2v-flash | 首尾帧视频生成 |
| **TTS** | 千问 | qwen3-tts-instruct-flash | 语音合成 |

### 2.3 系统架构图

```
┌─────────────────────────────────────────────────────────────────┐
│                      Nuxt.js 4 全栈架构                          │
├─────────────────────────────────────────────────────────────────┤
│  ┌───────────────────────────────────────────────────────────┐  │
│  │                 前端 (Vue 3 + shadcn-vue)                  │  │
│  │  pages/           │ components/      │ composables/        │  │
│  │  - index.vue      │ - ScriptEditor   │ - useProject()      │  │
│  │  - projects.vue   │ - CharacterCard  │ - useScript()       │  │
│  │  - workbench.vue  │ - VideoPreview   │ - useCharacter()    │  │
│  │  - settings.vue   │ - Timeline       │ - useVideoGen()     │  │
│  └───────────────────────────────────────────────────────────┘  │
│                              │                                   │
│                              ▼                                   │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │                  后端 API (Nitro Server)                   │  │
│  │  server/api/                                               │  │
│  │  - outline/generate      故事大纲生成                       │  │
│  │  - script/parse          剧本解析                          │  │
│  │  - character/generate    角色生成                          │  │
│  │  - storyboard/generate   分镜脚本生成                       │  │
│  │  - frame/generate        首尾帧生成                         │  │
│  │  - video/generate        视频生成                          │  │
│  │  - scene/chain           场景串联                          │  │
│  └───────────────────────────────────────────────────────────┘  │
│                              │                                   │
│                              ▼                                   │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │                   AI 服务层 (server/utils/)                │  │
│  │  - gemini.ts          Google Gemini 客户端                 │  │
│  │  - qwen.ts            阿里千问客户端                        │  │
│  │  - model-provider.ts  统一模型调度                          │  │
│  │  - ffmpeg.ts          视频处理工具                          │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 三、核心业务流程

### 3.1 完整创作流程

```
1. 创建项目
   ↓
2. 内容输入 (二选一)
   ├─ A: 输入故事创意 → 生成故事大纲 → 生成剧本/场景
   └─ B: 直接输入小说/剧本文本
   ↓
3. 解析为结构化场景 + 提取角色列表
   ↓
4. 生成角色立绘和表情变体 (作为参考图)
   ↓
5. 编辑场景内容 (对话、角色、设定)
   ↓
6. 生成分镜脚本
   ↓
7. 生成场景图片 (使用角色参考图保证一致性)
   ↓
8. 生成首尾帧 → 生成视频片段 (Gemini Veo 或 千问万相)
   ↓
9. 场景串联 → 完整漫剧视频
```

### 3.2 工作台四步工作流

| 步骤 | 功能 | 说明 |
|------|------|------|
| 1 | 故事/剧本 | 从创意生成大纲，或直接输入剧本文本，解析为场景 |
| 2 | 角色设定 | 从场景提取角色，生成立绘和表情变体作为参考图 |
| 3 | 场景编辑 | 编辑场景内容，生成分镜脚本和场景图片 |
| 4 | 视频生成 | 生成首尾帧和视频片段，场景串联输出 |

---

## 四、数据模型

### 4.1 核心类型定义

#### 场景 (Scene)
```typescript
interface Scene {
  id: string
  title?: string
  description: string
  setting: {
    location: string
    timeOfDay: 'dawn' | 'morning' | 'noon' | 'afternoon' | 'evening' | 'night'
    mood?: string
    weather?: string
  }
  characters: Array<{
    name: string
    appearance?: string
    action?: string
    emotion?: Emotion
  }>
  dialogues?: Array<{
    character: string
    text: string
    emotion?: Emotion
    isInnerThought?: boolean
  }>
  duration: number // 4-8秒
  narration?: string
}
```

#### 角色 (Character)
```typescript
interface Character {
  id: string
  name: string
  role?: 'protagonist' | 'antagonist' | 'supporting' | 'extra'
  appearance: string
  personality?: string
  traits?: string[]
  background?: string
  speakingStyle?: SpeakingStyle
}

interface CharacterAsset {
  characterId: string
  name: string
  baseImage: string // base64
  expressions: Record<Emotion, string> // 表情变体
  views?: Record<CharacterView, string> // 视角变体
}
```

#### 分镜脚本 (Storyboard)
```typescript
interface StoryboardShot {
  shotNumber: number
  shotType: ShotType // 景别: 大远景/全景/中景/近景/特写等
  cameraMovement: CameraMovement // 运镜: 定镜/推/拉/摇/跟等
  visualContent: string
  dialogue?: string
  character?: string
  emotion?: Emotion
  duration: number
}
```

#### 视频配置 (VideoGenerationConfig)
```typescript
interface VideoGenerationConfig {
  firstFrame?: string // 首帧 base64
  lastFrame?: string // 尾帧 base64
  prompt: string
  duration: 4 | 5 | 6 | 8 | 10 | 15
  resolution: '720p' | '1080p'
  aspectRatio: '16:9' | '9:16' | '1:1'
  withAudio: boolean
  provider?: 'gemini' | 'qwen'
}
```

### 4.2 数据库表结构

| 表名 | 说明 | 主要字段 |
|------|------|----------|
| `projects` | 项目表 | id, name, description, status |
| `scripts` | 剧本表 | id, projectId, rawText, parsedData |
| `scenes` | 场景表 | id, scriptId, description, setting, dialogues, firstFrame, lastFrame, videoUrl |
| `characters` | 角色表 | id, projectId, name, appearance, baseImage, expressions, views |
| `video_tasks` | 视频任务表 | id, sceneId, status, progress, config, error |

---

## 五、API 接口

### 5.1 项目管理

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/project/create` | 创建项目 |
| GET | `/api/project/list` | 获取项目列表 |
| GET | `/api/project/[id]` | 获取项目详情 |
| PUT | `/api/project/[id]` | 更新项目 |
| DELETE | `/api/project/[id]` | 删除项目 |

### 5.2 剧本处理

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/outline/generate` | 生成故事大纲 |
| POST | `/api/script/parse` | 解析剧本文本 |
| POST | `/api/scene/generate-from-outline` | 从大纲生成场景 |
| POST | `/api/scene/visual` | 提取场景视觉 |
| POST | `/api/storyboard/generate` | 生成分镜脚本 |

### 5.3 角色管理

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/character/extract` | 从剧本提取角色 |
| POST | `/api/character/extract-from-outline` | 从大纲提取角色 |
| POST | `/api/character/generate` | 生成角色立绘 |
| POST | `/api/character/expression` | 生成表情变体 |
| POST | `/api/character/views` | 生成多视角变体 |

### 5.4 视频生成

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/frame/generate` | 生成首尾帧 |
| POST | `/api/video/generate` | 启动视频生成任务 |
| GET | `/api/video/status/[id]` | 查询任务状态 |
| POST | `/api/scene/chain` | 场景串联 |

### 5.5 模型管理

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/models/list` | 获取可用模型列表 |
| POST | `/api/models/switch` | 切换模型 |
| POST | `/api/models/test` | 测试模型连接 |

### 5.6 流水线

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/pipeline/produce` | 基础生产流水线 |
| POST | `/api/pipeline/full` | 完整生产流水线 |

---

## 六、前端页面

### 6.1 页面路由

| 路径 | 页面 | 说明 |
|------|------|------|
| `/` | 首页 | 功能介绍、快速入口 |
| `/projects` | 项目管理 | 项目列表、创建、删除 |
| `/workbench` | 创作工作台 | 核心创作界面 (四步工作流) |
| `/settings` | 模型设置 | 选择和测试 AI 模型 |

### 6.2 核心组件

| 组件 | 说明 |
|------|------|
| `ScriptEditor` | 剧本编辑器 |
| `SceneCard` | 场景卡片 |
| `CharacterCard` | 角色卡片 |
| `ExpressionGrid` | 表情网格 |
| `VideoPreview` | 视频预览 |
| `FramePair` | 首尾帧展示 |
| `Timeline` | 场景时间轴 |

### 6.3 Composables

| 函数 | 说明 |
|------|------|
| `useProject()` | 项目 CRUD |
| `useScript()` | 剧本解析 |
| `useCharacter()` | 角色生成 |
| `useVideoGen()` | 视频生成 + 状态轮询 |
| `useWorkbench()` | 工作台集成 |

---

## 七、风格系统

### 7.1 风格分类

系统内置 100+ 种预设风格，分为 10 大类：

| 分类 | 说明 | 示例 |
|------|------|------|
| 日系动漫 | 日本动画风格 | 吉卜力、藤本树、赛璐璐 |
| 国风 | 中国传统风格 | 水墨、东方淡彩、3D国创 |
| 3D渲染 | 3D 动画风格 | 皮克斯、乐高、粘土 |
| 插画 | 插画艺术风格 | 水彩、彩铅、厚涂 |
| 复古 | 复古怀旧风格 | 80年代、胶片、蒸汽波 |
| Q萌可爱 | 可爱卡通风格 | Q版、马卡龙、治愈系 |
| 艺术风格 | 艺术流派风格 | 印象派、文艺复兴、浮世绘 |
| 漫画 | 漫画风格 | 美漫、欧漫、墨线 |
| 像素游戏 | 像素艺术风格 | 像素、故障艺术、赛博 |
| 特殊IP | 知名IP风格 | 海贼王、柯南、史努比 |

---

## 八、项目结构

```
manju/
├── app/                          # 前端应用
│   ├── pages/                    # 页面路由
│   │   ├── index.vue             # 首页
│   │   ├── projects.vue          # 项目列表
│   │   ├── workbench.vue         # 创作工作台
│   │   └── settings.vue          # 模型设置
│   ├── components/               # Vue 组件
│   │   ├── script/               # 剧本相关
│   │   ├── character/            # 角色相关
│   │   ├── video/                # 视频相关
│   │   └── ui/                   # 通用UI (shadcn)
│   ├── composables/              # 组合式函数
│   ├── layouts/                  # 布局
│   └── assets/                   # 静态资源
├── server/                       # 后端服务
│   ├── api/                      # API 路由
│   │   ├── project/              # 项目管理
│   │   ├── script/               # 剧本处理
│   │   ├── outline/              # 大纲生成
│   │   ├── character/            # 角色管理
│   │   ├── storyboard/           # 分镜脚本
│   │   ├── frame/                # 首尾帧
│   │   ├── video/                # 视频生成
│   │   ├── scene/                # 场景处理
│   │   ├── audio/                # 音频生成
│   │   ├── models/               # 模型管理
│   │   └── pipeline/             # 流水线
│   ├── db/                       # 数据库
│   │   ├── index.ts              # 数据库连接
│   │   └── schema.ts             # 表结构定义
│   └── utils/                    # 工具函数
│       ├── gemini.ts             # Gemini 客户端
│       ├── qwen.ts               # 千问客户端
│       ├── model-provider.ts     # 统一模型调度
│       ├── ffmpeg.ts             # 视频处理
│       ├── concurrency.ts        # 并发控制
│       ├── cache.ts              # 缓存管理
│       └── logger.ts             # 日志系统
├── shared/                       # 前后端共享
│   └── types/                    # 类型定义
│       ├── script.ts             # 剧本类型
│       ├── character.ts          # 角色类型
│       ├── video.ts              # 视频类型
│       ├── audio.ts              # 音频类型
│       ├── outline.ts            # 大纲类型
│       ├── storyboard.ts         # 分镜类型
│       ├── scene-visual.ts       # 场景视觉类型
│       ├── styles.ts             # 风格预设
│       └── provider.ts           # 模型提供商类型
├── public/                       # 静态文件
│   └── videos/                   # 生成的视频
├── data/                         # SQLite 数据库
├── nuxt.config.ts                # Nuxt 配置
├── drizzle.config.ts             # Drizzle 配置
├── tailwind.config.js            # Tailwind 配置
└── package.json
```

---

## 九、环境配置

### 9.1 环境变量

```bash
# .env

# Google Gemini API
GEMINI_API_KEY=your_gemini_api_key

# 阿里千问 API
QWEN_API_KEY=your_qwen_api_key

# 代理配置 (可选)
HTTP_PROXY=http://127.0.0.1:7890
HTTPS_PROXY=http://127.0.0.1:7890

# 输出配置
OUTPUT_DIR=./output
TEMP_DIR=./temp

# 视频默认参数
DEFAULT_RESOLUTION=1080p
DEFAULT_ASPECT_RATIO=16:9
DEFAULT_DURATION=8

# 并发控制
MAX_CONCURRENT_REQUESTS=3

# 成本控制
DAILY_BUDGET_LIMIT=50

# 日志级别
LOG_LEVEL=info
```

### 9.2 开发命令

```bash
# 安装依赖
bun install

# 开发模式
bun run dev

# 构建
bun run build

# 预览
bun run preview

# 数据库操作
bun run db:generate  # 生成迁移
bun run db:migrate   # 执行迁移
bun run db:push      # 推送变更
bun run db:studio    # 启动 Studio

# 代码检查
bun run lint
bun run typecheck
```

---

## 十、依赖清单

```json
{
  "dependencies": {
    "@google/genai": "^1.32.0",
    "@pinia/nuxt": "^0.9.0",
    "@vueuse/core": "^13.5.0",
    "better-sqlite3": "^12.5.0",
    "class-variance-authority": "^0.7.1",
    "clsx": "^2.1.1",
    "drizzle-orm": "^0.45.0",
    "fluent-ffmpeg": "^2.1.3",
    "lucide-vue-next": "^0.511.0",
    "nuxt": "^4.2.1",
    "pinia": "^3.0.4",
    "radix-vue": "^1.9.17",
    "sharp": "^0.33.5",
    "tailwind-merge": "^3.1.0",
    "zod": "^3.25.76"
  },
  "devDependencies": {
    "@nuxt/eslint": "^1.10.0",
    "@nuxt/test-utils": "^3.21.0",
    "@nuxtjs/tailwindcss": "^6.14.0",
    "drizzle-kit": "^0.31.8",
    "eslint": "^9.39.1",
    "shadcn-nuxt": "^2.4.2",
    "typescript": "^5.8.3",
    "vitest": "^2.1.9"
  }
}
```

---

## 十一、成本估算

### 11.1 API 定价参考

| 模型 | 价格 | 备注 |
|------|------|------|
| Gemini 2.5 Flash | $0.075/1M tokens (输入) | 文本处理 |
| Nano Banana Pro | ~$0.02/图片 | 图片生成 |
| Veo 3.1 | ~$0.35/秒 | 8秒≈$2.8 |
| 千问万相 (图片) | ¥0.02/张 | 图片生成 |
| 千问万相 (视频) | ¥0.3/秒 | 视频生成 |

### 11.2 单分钟漫剧成本估算

- 视频生成 (8个8秒片段): ~$22
- 图片生成 (20张): ~$0.4
- 文本处理: ~$0.5
- **总计**: ≈$23/分钟 ≈ ¥165/分钟

---

## 十二、已实现功能

### ✅ 已完成

- [x] 项目管理 (CRUD)
- [x] 故事大纲生成 (三幕结构)
- [x] 剧本智能解析
- [x] 角色提取与生成
- [x] 多表情/多视角变体
- [x] 分镜脚本生成
- [x] 场景视觉提取
- [x] 首尾帧生成
- [x] 视频生成 (Gemini Veo + 千问万相)
- [x] 场景串联与转场
- [x] 模型切换与测试
- [x] 批量生成支持
- [x] 成本/时间预估
- [x] 100+ 风格预设
- [x] 并发控制
- [x] 缓存机制
- [x] 日志系统

### 🔄 待优化

- [ ] 角色一致性增强
- [ ] Lyria 背景音乐生成 (需 Live API)
- [ ] 断点续传
- [ ] 协作功能
- [ ] 移动端支持

---

*文档结束*
