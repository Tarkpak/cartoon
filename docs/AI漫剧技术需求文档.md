# AI漫剧技术需求文档

> **版本**: 1.1  
> **日期**: 2025年12月9日  
> **技术栈**: Nuxt.js 4 全栈 + Google Gemini API  

---

## 一、项目概述

### 1.1 项目背景

2025年被业内公认为"漫剧元年"和"AI Agent元年"。AI漫剧市场规模预估达200亿，正处于爆发期。本项目旨在基于Google系列LLM构建一个完整的AI漫剧生成系统。

### 1.2 核心目标

- 实现文本到视频的端到端AI漫剧生成
- 支持首尾帧控制，确保场景连贯性
- 提供角色一致性保障
- 降低单分钟制作成本至200-500元

---

## 二、技术架构

### 2.1 技术栈选型

| 层级 | 技术选型 | 说明 |
|------|----------|------|
| **全栈框架** | Nuxt.js 4.2.1 | Vue 3 + Nitro Server + 自动路由 |
| **语言** | TypeScript | 类型安全、生态丰富 |
| **UI框架** | Nuxt UI 3 | 基于 Tailwind CSS 的组件库 |
| **服务端** | Nitro | Nuxt内置服务引擎，支持API路由 |
| **AI核心** | Google Gemini API | `@google/genai` SDK |
| **视频生成** | Veo 3.1 API | 支持首尾帧、8秒视频 |
| **图片生成** | Nano Banana Pro | 原生图片生成与编辑 |
| **文本理解** | Gemini 3 Pro | 100万token上下文窗口 |
| **音频生成** | Lyria API | 背景音乐生成 |
| **状态管理** | Pinia | Vue官方推荐 |
| **数据库** | SQLite / PostgreSQL | 项目管理、任务队列 |

### 2.2 系统架构图

```
┌─────────────────────────────────────────────────────────────────┐
│                   Nuxt.js 4 全栈架构                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌───────────────────────────────────────────────────────────┐   │
│  │                    前端 (Vue 3 + Nuxt UI)                    │   │
│  │  pages/           │ components/      │ composables/         │   │
│  │  - index.vue      │ - ScriptEditor   │ - useGemini()        │   │
│  │  - projects/      │ - VideoPreview   │ - useVideoGen()      │   │
│  │  - generate/      │ - CharacterCard  │ - useProject()       │   │
│  └───────────────────────────────────────────────────────────┘   │
│                              │                                     │
│                              ▼                                     │
│  ┌───────────────────────────────────────────────────────────┐   │
│  │                   后端 API (Nitro Server)                    │   │
│  │  server/api/                                                 │   │
│  │  - script/parse.post.ts      剧本解析 (Gemini 3)            │   │
│  │  - character/generate.post.ts 角色生成 (Nano Banana)         │   │
│  │  - video/generate.post.ts    视频生成 (Veo 3.1)             │   │
│  │  - video/status/[id].get.ts  生成状态查询                   │   │
│  │  - audio/generate.post.ts    音频生成 (Lyria)               │   │
│  └───────────────────────────────────────────────────────────┘   │
│                              │                                     │
│                              ▼                                     │
│  ┌───────────────────────────────────────────────────────────┐   │
│  │                   AI 服务层 (server/utils/)                  │   │
│  │  - gemini.ts         Google Gemini 客户端                   │   │
│  │  - veo.ts            Veo 视频生成服务                       │   │
│  │  - nanoBanana.ts     Nano Banana 图片生成                   │   │
│  │  - lyria.ts          Lyria 音频生成                         │   │
│  └───────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

---

## 三、核心模块设计

### 3.1 剧本解析模块

**功能**: 将小说/剧本文本解析为结构化的分镜脚本

**使用模型**: `gemini-3-pro-preview`

```typescript
// types/script.ts
interface Scene {
  id: string;
  description: string;
  dialogue: DialogueLine[];
  characters: Character[];
  setting: SceneSetting;
  duration: number; // 秒
  cameraMovement: CameraMovement;
}

interface DialogueLine {
  character: string;
  text: string;
  emotion: Emotion;
  voiceStyle?: VoiceStyle;
}

interface Character {
  name: string;
  appearance: string;
  referenceImageId?: string;
}

interface SceneSetting {
  location: string;
  timeOfDay: 'day' | 'night' | 'dawn' | 'dusk';
  weather?: string;
  mood: string;
}
```

**API调用示例**:

```typescript
import { GoogleGenAI } from '@google/genai';

const client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

async function parseScript(novelText: string): Promise<Scene[]> {
  const response = await client.models.generateContent({
    model: 'gemini-3-pro-preview',
    contents: `
      你是一个专业的漫剧分镜师。请将以下小说文本转换为分镜脚本。
      
      要求:
      1. 每个场景时长控制在6-8秒
      2. 明确描述角色外观、表情、动作
      3. 指定场景氛围和镜头运动
      4. 提取对话并标注情绪
      
      小说文本:
      ${novelText}
      
      请以JSON格式输出分镜脚本。
    `,
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: SceneArraySchema,
    },
  });
  
  return JSON.parse(response.text);
}
```

### 3.2 角色资产生成模块 (Nano Banana Pro)

**功能**: 生成并维护角色一致性图片库

**使用模型**: `gemini-2.5-flash-preview-native-image-out` (Nano Banana Pro)

```typescript
// services/characterGenerator.ts
interface CharacterAsset {
  characterId: string;
  name: string;
  baseImage: string; // base64
  expressions: Map<Emotion, string>;
  poses: Map<Pose, string>;
}

async function generateCharacterAsset(
  character: Character
): Promise<CharacterAsset> {
  const client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  
  // 生成基础角色图
  const baseResponse = await client.models.generateContent({
    model: 'gemini-2.5-flash-preview-native-image-out',
    contents: `
      生成一个高质量的动漫角色立绘:
      - 角色描述: ${character.appearance}
      - 风格: 日式动漫，高清，精致细节
      - 视角: 正面半身像
      - 背景: 纯色透明
    `,
    generationConfig: {
      responseModalities: ['image', 'text'],
    },
  });
  
  const baseImage = baseResponse.candidates[0].content.parts
    .find(part => part.inlineData)?.inlineData?.data;
  
  // 生成不同表情变体
  const expressions = new Map<Emotion, string>();
  for (const emotion of ['happy', 'sad', 'angry', 'surprised', 'neutral']) {
    const exprResponse = await client.models.generateContent({
      model: 'gemini-2.5-flash-preview-native-image-out',
      contents: [
        {
          inlineData: {
            mimeType: 'image/png',
            data: baseImage,
          },
        },
        {
          text: `基于这个角色，生成${emotion}表情的版本，保持角色特征完全一致。`,
        },
      ],
      generationConfig: {
        responseModalities: ['image', 'text'],
      },
    });
    
    expressions.set(
      emotion as Emotion,
      exprResponse.candidates[0].content.parts
        .find(part => part.inlineData)?.inlineData?.data
    );
  }
  
  return {
    characterId: generateId(),
    name: character.name,
    baseImage,
    expressions,
    poses: new Map(),
  };
}
```

### 3.3 首尾帧视频生成模块 (Veo 3.1)

**功能**: 基于首尾帧生成连贯的动态视频片段

**使用模型**: `veo-3.1-generate-preview`

**核心技术**: **首尾帧插值** - 设定开头和结尾关键帧，AI自动补全中间动态过渡

```typescript
// services/videoGenerator.ts
interface VideoGenerationConfig {
  firstFrame: string;  // base64 图片
  lastFrame: string;   // base64 图片
  prompt: string;
  duration: 4 | 6 | 8; // 秒
  resolution: '720p' | '1080p';
  aspectRatio: '16:9' | '9:16' | '1:1';
  withAudio: boolean;
}

interface GeneratedVideo {
  videoData: string; // base64
  audioData?: string;
  duration: number;
  metadata: VideoMetadata;
}

async function generateVideoWithFrames(
  config: VideoGenerationConfig
): Promise<GeneratedVideo> {
  const client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  
  // 使用首尾帧生成视频
  const operation = await client.models.generateVideos({
    model: 'veo-3.1-generate-preview',
    prompt: config.prompt,
    image: {
      imageBytes: config.firstFrame,
      mimeType: 'image/png',
    },
    lastFrame: {
      imageBytes: config.lastFrame,
      mimeType: 'image/png',
    },
    config: {
      aspectRatio: config.aspectRatio,
      numberOfVideos: 1,
      durationSeconds: config.duration,
      resolution: config.resolution,
      personGeneration: 'allow_adult',
      generateAudio: config.withAudio,
    },
  });
  
  // 轮询等待视频生成完成
  let result = await client.operations.get({ name: operation.name });
  while (!result.done) {
    await sleep(5000);
    result = await client.operations.get({ name: operation.name });
  }
  
  const video = result.response.generatedVideos[0];
  
  return {
    videoData: video.video.videoBytes,
    audioData: video.audio?.audioBytes,
    duration: config.duration,
    metadata: {
      model: 'veo-3.1-generate-preview',
      generatedAt: new Date().toISOString(),
    },
  };
}
```

### 3.4 场景连贯性控制

**核心策略**: 使用上一个场景的最后一帧作为下一个场景的参考

```typescript
// services/sceneChainer.ts
interface SceneChain {
  scenes: GeneratedScene[];
  transitions: Transition[];
}

async function generateSceneChain(
  scenes: Scene[],
  characterAssets: Map<string, CharacterAsset>
): Promise<SceneChain> {
  const generatedScenes: GeneratedScene[] = [];
  let previousLastFrame: string | null = null;
  
  for (let i = 0; i < scenes.length; i++) {
    const scene = scenes[i];
    
    // 生成场景首帧
    const firstFrame = await generateSceneFrame(scene, characterAssets, 'first');
    
    // 生成场景尾帧
    const lastFrame = await generateSceneFrame(scene, characterAssets, 'last');
    
    // 如果有前一个场景，创建过渡
    if (previousLastFrame) {
      // 使用首尾帧生成过渡视频
      const transitionVideo = await generateVideoWithFrames({
        firstFrame: previousLastFrame,
        lastFrame: firstFrame,
        prompt: `平滑过渡，从上一个场景切换到${scene.setting.location}`,
        duration: 4,
        resolution: '1080p',
        aspectRatio: '16:9',
        withAudio: false,
      });
    }
    
    // 生成主场景视频
    const sceneVideo = await generateVideoWithFrames({
      firstFrame,
      lastFrame,
      prompt: buildScenePrompt(scene),
      duration: scene.duration as 4 | 6 | 8,
      resolution: '1080p',
      aspectRatio: '16:9',
      withAudio: true,
    });
    
    generatedScenes.push({
      sceneId: scene.id,
      video: sceneVideo,
      firstFrame,
      lastFrame,
    });
    
    previousLastFrame = lastFrame;
  }
  
  return { scenes: generatedScenes, transitions: [] };
}
```

### 3.5 配音与音效模块

**功能**: AI语音合成 + 背景音乐生成

```typescript
// services/audioGenerator.ts
interface AudioConfig {
  dialogue: DialogueLine[];
  sceneMood: string;
  duration: number;
}

async function generateSceneAudio(config: AudioConfig): Promise<AudioAsset> {
  const client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  
  // 使用Lyria生成背景音乐
  const bgmResponse = await client.models.generateContent({
    model: 'lyria-realtime-exp',
    contents: `
      生成${config.duration}秒的背景音乐:
      - 氛围: ${config.sceneMood}
      - 风格: 动漫配乐
      - 强度: 中等，不要盖过对话
    `,
  });
  
  // 对话语音合成 (使用Live API的TTS功能)
  const dialogueAudios: DialogueAudio[] = [];
  for (const line of config.dialogue) {
    const ttsResponse = await client.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: line.text,
      generationConfig: {
        responseModalities: ['audio'],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: {
              voiceName: getVoiceForCharacter(line.character),
            },
          },
        },
      },
    });
    
    dialogueAudios.push({
      characterName: line.character,
      audioData: ttsResponse.candidates[0].content.parts[0].inlineData.data,
    });
  }
  
  return {
    backgroundMusic: bgmResponse.candidates[0].content.parts[0].inlineData.data,
    dialogues: dialogueAudios,
  };
}
```

---

## 四、API参考

### 4.1 Google Gemini API 模型列表

| 模型 | 用途 | 特点 |
|------|------|------|
| `gemini-3-pro-preview` | 文本理解/剧本解析 | 100万token上下文，强推理能力 |
| `gemini-2.5-flash` | 通用任务/TTS | 高速，100万token上下文 |
| `gemini-2.5-flash-preview-native-image-out` | 图片生成 (Nano Banana Pro) | 原生图片生成与编辑 |
| `veo-3.1-generate-preview` | 视频生成 | 8秒1080p，支持首尾帧，带音频 |
| `veo-3.1-fast-preview` | 快速视频生成 | 速度优化，适合批量 |
| `lyria-realtime-exp` | 音乐生成 | 背景音乐 |

### 4.2 TypeScript SDK 安装

```bash
# 推荐的新版SDK (2025年5月GA)
npm install @google/genai

# 或使用 pnpm/yarn
pnpm add @google/genai
yarn add @google/genai
```

### 4.3 SDK初始化

```typescript
// lib/gemini.ts
import { GoogleGenAI } from '@google/genai';

// 单例模式
let client: GoogleGenAI | null = null;

export function getGeminiClient(): GoogleGenAI {
  if (!client) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY environment variable is required');
    }
    client = new GoogleGenAI({ apiKey });
  }
  return client;
}

// 配置类型
export interface GeminiConfig {
  apiKey: string;
  maxRetries?: number;
  timeout?: number;
}
```

---

## 五、Veo 3.1 首尾帧技术详解

### 5.1 首尾帧功能说明

**首尾帧 (First & Last Frame)** 是Veo 3.1的核心功能，允许创作者：

1. 设定视频**开头关键帧** - 明确起始状态
2. 设定视频**结尾关键帧** - 明确目标状态  
3. AI自动补全中间的**动态过渡和情节衔接**

### 5.2 技术参数

| 参数 | Veo 3.1 | Veo 3 | Veo 2 |
|------|---------|-------|-------|
| 首尾帧支持 | ✅ 完整支持 | ✅ 支持 | ✅ 支持 |
| 视频时长 | 4/6/8秒 | 8秒 | 5-8秒 |
| 分辨率 | 720p/1080p | 720p/1080p(16:9) | 720p |
| 原生音频 | ✅ 对话+环境音 | ✅ | ❌ |
| 帧速率 | 24fps | 24fps | 24fps |

### 5.3 最佳实践

```typescript
// 首尾帧生成的最佳实践
const bestPractices = {
  // 1. 首尾帧应使用相同的角色和场景
  consistency: '确保首尾帧的角色外观、服装、场景保持一致',
  
  // 2. 动作变化要合理
  motionRange: '8秒视频内，角色位置变化不要过大',
  
  // 3. 提示词要详细
  promptDetail: '描述动作过程，而不仅仅是结果',
  
  // 4. 使用Nano Banana Pro生成首尾帧
  frameGeneration: '使用gemini-2.5-flash-preview-native-image-out生成首尾帧，确保风格统一',
};

// 示例：生成首尾帧
async function generateFramePair(scene: Scene): Promise<[string, string]> {
  const client = getGeminiClient();
  
  // 生成首帧
  const firstFrameResponse = await client.models.generateContent({
    model: 'gemini-2.5-flash-preview-native-image-out',
    contents: `
      动漫风格场景:
      地点: ${scene.setting.location}
      时间: ${scene.setting.timeOfDay}
      角色: ${scene.characters.map(c => c.appearance).join(', ')}
      动作: 场景开始时的姿态
      氛围: ${scene.setting.mood}
    `,
    generationConfig: {
      responseModalities: ['image'],
    },
  });
  
  // 生成尾帧
  const lastFrameResponse = await client.models.generateContent({
    model: 'gemini-2.5-flash-preview-native-image-out',
    contents: `
      基于相同的场景和角色，展示${scene.duration}秒后的状态:
      ${scene.description}
      保持角色外观完全一致，仅改变姿态和表情。
    `,
    generationConfig: {
      responseModalities: ['image'],
    },
  });
  
  return [
    firstFrameResponse.candidates[0].content.parts[0].inlineData.data,
    lastFrameResponse.candidates[0].content.parts[0].inlineData.data,
  ];
}
```

---

## 六、项目结构 (Nuxt.js 4)

```
manju/
├── app/                          # Nuxt 4 应用目录
│   ├── pages/                    # 页面路由
│   │   ├── index.vue             # 首页
│   │   ├── projects/             # 项目管理
│   │   │   ├── index.vue         # 项目列表
│   │   │   └── [id].vue          # 项目详情
│   │   └── generate/             # 生成工作台
│   │       ├── script.vue        # 剧本编辑
│   │       ├── characters.vue    # 角色管理
│   │       └── video.vue         # 视频生成
│   ├── components/               # Vue 组件
│   │   ├── script/
│   │   │   ├── ScriptEditor.vue  # 剧本编辑器
│   │   │   └── SceneCard.vue     # 场景卡片
│   │   ├── character/
│   │   │   ├── CharacterCard.vue # 角色卡片
│   │   │   └── ExpressionGrid.vue# 表情网格
│   │   ├── video/
│   │   │   ├── VideoPreview.vue  # 视频预览
│   │   │   ├── FramePair.vue     # 首尾帧展示
│   │   │   └── Timeline.vue      # 时间轴
│   │   └── ui/                   # 通用UI组件
│   ├── composables/              # 组合式函数
│   │   ├── useProject.ts         # 项目管理
│   │   ├── useScript.ts          # 剧本操作
│   │   ├── useCharacter.ts       # 角色操作
│   │   ├── useVideoGen.ts        # 视频生成
│   │   └── useGemini.ts          # Gemini API调用
│   ├── layouts/                  # 布局
│   │   └── default.vue
│   └── app.vue                   # 根组件
├── server/                       # Nitro 服务端
│   ├── api/                      # API 路由
│   │   ├── script/
│   │   │   └── parse.post.ts     # POST /api/script/parse
│   │   ├── character/
│   │   │   └── generate.post.ts  # POST /api/character/generate
│   │   ├── video/
│   │   │   ├── generate.post.ts  # POST /api/video/generate
│   │   │   └── status/
│   │   │       └── [id].get.ts   # GET /api/video/status/:id
│   │   └── audio/
│   │       └── generate.post.ts  # POST /api/audio/generate
│   ├── utils/                    # 服务端工具
│   │   ├── gemini.ts             # Gemini 客户端
│   │   ├── veo.ts                # Veo 视频生成
│   │   ├── nanoBanana.ts         # Nano Banana 图片
│   │   ├── lyria.ts              # Lyria 音频
│   │   └── ffmpeg.ts             # FFmpeg 视频处理
│   └── middleware/               # 服务端中间件
├── shared/                       # 前后端共享
│   └── types/                    # 类型定义
│       ├── script.ts
│       ├── character.ts
│       ├── video.ts
│       └── audio.ts
├── public/                       # 静态资源
├── output/                       # 生成输出
├── nuxt.config.ts                # Nuxt 配置
├── package.json
├── tsconfig.json
└── .env
```

---

## 七、依赖清单 (Nuxt.js 4)

```json
{
  "name": "manju-ai-manga",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "nuxt dev",
    "build": "nuxt build",
    "generate": "nuxt generate",
    "preview": "nuxt preview",
    "postinstall": "nuxt prepare",
    "lint": "eslint .",
    "typecheck": "nuxt typecheck"
  },
  "dependencies": {
    "@google/genai": "^1.0.0",
    "@nuxt/ui": "^3.0.0",
    "@pinia/nuxt": "^0.9.0",
    "nuxt": "^4.2.1",
    "pinia": "^3.0.0",
    "vue": "^3.5.0",
    "zod": "^3.23.0",
    "sharp": "^0.33.0",
    "fluent-ffmpeg": "^2.1.3"
  },
  "devDependencies": {
    "@nuxt/eslint": "^1.0.0",
    "@nuxt/test-utils": "^3.15.0",
    "@types/fluent-ffmpeg": "^2.1.24",
    "@vue/test-utils": "^2.4.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  }
}
```

---

## 八、环境变量配置

```bash
# .env.example

# Google Gemini API
GEMINI_API_KEY=your_api_key_here

# 可选：代理配置
# HTTP_PROXY=http://127.0.0.1:7890
# HTTPS_PROXY=http://127.0.0.1:7890

# 输出配置
OUTPUT_DIR=./output
TEMP_DIR=./temp

# 视频参数
DEFAULT_RESOLUTION=1080p
DEFAULT_ASPECT_RATIO=16:9
DEFAULT_DURATION=8

# 日志级别
LOG_LEVEL=info
```

---

## 九、API定价参考 (2025年12月)

| 模型 | 输入价格 | 输出价格 | 备注 |
|------|----------|----------|------|
| Gemini 3 Pro | $1.25/1M tokens | $10/1M tokens | 文本处理 |
| Gemini 2.5 Flash | $0.075/1M tokens | $0.30/1M tokens | 通用任务 |
| Nano Banana Pro | - | $0.02/图片 | 图片生成 |
| Veo 3.1 | - | ~$0.35/秒 | 8秒≈$2.8 |
| Veo 3.1 Fast | - | ~$0.10/秒 | 速度优化版 |

**成本估算** (1分钟漫剧 ≈ 8个8秒片段):
- 视频生成: 8 × $2.8 = $22.4
- 图片生成: 约20张 × $0.02 = $0.4
- 文本处理: 约$0.5
- **总计**: ≈$23/分钟 ≈ ¥165/分钟

---

## 十、开发路线图

### Phase 1 - MVP (2周)
- [x] 技术调研与选型
- [ ] 项目脚手架搭建
- [ ] Gemini API集成
- [ ] 基础剧本解析

### Phase 2 - 核心功能 (4周)
- [ ] Nano Banana Pro角色生成
- [ ] 首尾帧生成模块
- [ ] Veo 3.1视频生成集成
- [ ] 场景串联逻辑

### Phase 3 - 完善 (2周)
- [ ] 音频生成与合成
- [ ] 视频后处理流水线
- [ ] 批量处理优化
- [ ] 错误处理与重试机制

### Phase 4 - 优化 (2周)
- [ ] 成本优化（使用Veo 3.1 Fast）
- [ ] 质量提升
- [ ] Agent自动化流程
- [ ] 监控与日志

---

## 十一、参考资源

- [Gemini API 官方文档](https://ai.google.dev/gemini-api/docs)
- [Veo 视频生成指南](https://ai.google.dev/gemini-api/docs/video)
- [Nano Banana Pro 图片生成](https://ai.google.dev/gemini-api/docs/imagen)
- [@google/genai TypeScript SDK](https://github.com/googleapis/js-genai)
- [Gemini API Cookbook](https://github.com/google-gemini/cookbook)

---

## 附录A: 完整生产流水线示例

```typescript
// pipeline/productionPipeline.ts
import { getGeminiClient } from '../lib/gemini';
import { parseScript } from '../services/scriptParser';
import { generateCharacterAsset } from '../services/characterGenerator';
import { generateSceneChain } from '../services/sceneChainer';
import { mergeVideos } from '../utils/videoUtils';

export async function produceEpisode(
  novelText: string,
  outputPath: string
): Promise<void> {
  const client = getGeminiClient();
  
  console.log('📖 Step 1: 解析剧本...');
  const scenes = await parseScript(novelText);
  console.log(`   生成 ${scenes.length} 个场景`);
  
  console.log('🎨 Step 2: 生成角色资产...');
  const allCharacters = new Set(scenes.flatMap(s => s.characters));
  const characterAssets = new Map();
  for (const character of allCharacters) {
    const asset = await generateCharacterAsset(character);
    characterAssets.set(character.name, asset);
  }
  console.log(`   生成 ${characterAssets.size} 个角色`);
  
  console.log('🎬 Step 3: 生成视频片段...');
  const sceneChain = await generateSceneChain(scenes, characterAssets);
  console.log(`   生成 ${sceneChain.scenes.length} 个视频片段`);
  
  console.log('🔗 Step 4: 合并视频...');
  const videos = sceneChain.scenes.map(s => s.video.videoData);
  await mergeVideos(videos, outputPath);
  
  console.log(`✅ 完成! 输出: ${outputPath}`);
}

// 使用示例
produceEpisode(
  `
  第一章：觉醒
  林凡从昏迷中醒来，发现自己身处一片陌生的森林。
  "这是哪里？"他困惑地环顾四周。
  突然，一道金光从天而降...
  `,
  './output/episode_001.mp4'
);
```

---

*文档结束*
