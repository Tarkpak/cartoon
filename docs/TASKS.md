# 开发任务清单 (Nuxt.js 4 全栈)

> 技术栈: Nuxt.js 4.2.1 + Vue 3 + Nitro + shadcn-vue + Tailwind CSS + Drizzle ORM + SQLite + Google Gemini API  
> 按优先级排序，建议按顺序完成

---

## Phase 1: 项目初始化 (预计2天)

### 1.1 Nuxt项目搭建 ⏱️ 0.5天 ✅ 已完成
- [x] 使用 `npx nuxi@latest init manju` 初始化项目
- [x] 配置 `nuxt.config.ts` (按官方脚手架格式)
- [x] 安装依赖 `bun install`
- [x] 配置 shadcn-vue (`shadcn-nuxt` 模块)
- [x] 配置环境变量 `.env`
- [x] 配置 ESLint (`eslint.config.mjs`)
- [x] 配置 CSS (`app/assets/css/main.css`)

**验收标准**: `pnpm dev` 能正常启动，访问 http://localhost:3000

### 1.2 Gemini API 集成 ⏱️ 0.5天 ✅ 已完成
- [x] 创建 `server/utils/gemini.ts` - API客户端
- [x] 配置 `runtimeConfig` 存储 API Key
- [x] 创建测试API `server/api/test.get.ts`
- [x] 添加错误处理和重试机制
  - [x] `GeminiError` 自定义错误类
  - [x] `GeminiErrorCode` 错误码枚举 (400/403/404/429/500/503/504)
  - [x] `withRetry()` 指数退避重试 (带抖动)
  - [x] `generateText()` 文本生成辅助函数
  - [x] `generateJSON()` JSON 结构化输出辅助函数
  - [x] `generateImage()` 图片生成辅助函数

**验收标准**: 访问 `/api/test` 能成功返回 Gemini 响应

### 1.3 类型定义 ⏱️ 1天 ✅ 已完成
- [x] `shared/types/script.ts` - 剧本/场景类型
- [x] `shared/types/character.ts` - 角色类型
- [x] `shared/types/video.ts` - 视频配置类型
- [x] `shared/types/audio.ts` - 音频类型
- [x] 使用 Zod 创建运行时校验 schema

**验收标准**: 前后端都能正确导入类型

### 1.4 数据库配置 ⏱️ 0.5天 ✅ 已完成
- [x] 配置 Drizzle ORM + SQLite (`better-sqlite3`)
- [x] 创建数据库 Schema (`server/db/schema.ts`)
  - [x] `projects` - 项目表
  - [x] `scripts` - 剧本表
  - [x] `scenes` - 场景表
  - [x] `characters` - 角色表
  - [x] `videoTasks` - 视频任务表
  - [x] `generatedVideos` - 生成视频表
- [x] 创建数据库连接 (`server/db/index.ts`)
- [x] 创建 Nitro 插件自动初始化 (`server/plugins/db.ts`)
- [x] 配置 Drizzle Kit (`drizzle.config.ts`)

**数据库命令**:
```bash
bun run db:generate  # 生成迁移文件
bun run db:migrate   # 执行迁移
bun run db:push      # 推送 schema 变更
bun run db:studio    # 启动 Drizzle Studio
```

**验收标准**: 数据库表自动创建，API 可正常读写数据

---

## Phase 2: 后端API开发 (预计1.5周)

### 2.1 剧本解析API ⏱️ 2天 ✅ 已完成
**文件**: `server/api/script/parse.post.ts`

- [x] 实现 `parseScript(text: string): Promise<Scene[]>`
- [x] 使用 Gemini 3 Pro 解析小说文本
- [x] 输出结构化的场景列表
- [x] 自动拆分对话、场景描述、角色信息
- [x] 支持 JSON 结构化输出
- [x] 输出格式验证和自动修复

**输入示例**:
```
林凡从昏迷中醒来，发现自己身处陌生森林。
"这是哪里？"他困惑地环顾四周。
```

**输出示例**:
```json
{
  "scenes": [{
    "id": "scene_001",
    "description": "林凡在森林中醒来",
    "dialogue": [{"character": "林凡", "text": "这是哪里？", "emotion": "confused"}],
    "setting": {"location": "森林", "timeOfDay": "day"}
  }]
}
```

**验收标准**: 能正确解析测试小说片段

---

### 2.2 角色生成API ⏱️ 3天 ✅ 已完成
**文件**: `server/api/character/generate.post.ts`

- [x] 实现 `generateCharacterAsset(character): Promise<CharacterAsset>`
- [x] 使用 Nano Banana Pro (`gemini-3-pro-image-preview`) 生成角色立绘 (4K高质量)
- [x] 生成多个表情变体 (happy, sad, angry, surprised, neutral)
- [x] 实现角色一致性保持（基于参考图编辑）
- [ ] 图片缓存机制（避免重复生成）- 后续优化

**关键API调用**:
```typescript
// Nano Banana Pro (4K高质量) 或 Nano Banana (快速)
model: 'gemini-3-pro-image-preview' // 或 'gemini-2.5-flash-image'
generationConfig: { responseModalities: ['image', 'text'] }
```

**验收标准**: 
- 能生成指定角色的5种表情
- 表情变体保持角色特征一致

---

### 2.3 首尾帧生成API ⏱️ 2天 ✅ 已完成
**文件**: `server/api/frame/generate.post.ts`

- [x] 实现 `generateFramePair(scene): Promise<[firstFrame, lastFrame]>`
- [x] 基于场景描述生成首帧
- [x] 基于场景结束状态生成尾帧
- [x] 确保首尾帧风格、角色一致
- [x] 支持将角色资产融入场景

**验收标准**: 首尾帧视觉风格统一，角色可辨识

---

### 2.4 视频生成API ⭐核心 ⏱️ 3天 ✅ 已完成
**文件**: `server/api/video/generate.post.ts` + `server/api/video/status/[id].get.ts`

- [x] 实现 `generateVideoWithFrames(config): Promise<GeneratedVideo>`
- [x] 集成 Veo 3.1 API (`veo-3.1-generate-preview`)
- [x] 支持首尾帧输入 (插值模式)
- [x] 实现长轮询等待视频生成
- [x] 支持 4/6/8 秒时长选择
- [x] 支持 720p/1080p 分辨率 (注意: 1080p 仅支持 8 秒时长)
- [x] 支持原生音频生成
- [x] 任务状态查询 API

**关键API调用**:
```typescript
await client.models.generateVideos({
  model: 'veo-3.1-generate-preview',
  prompt: '...',
  image: { imageBytes: firstFrame, mimeType: 'image/png' },  // 第一帧
  config: {
    lastFrame: { imageBytes: lastFrame, mimeType: 'image/png' },  // 最后一帧
    aspectRatio: '16:9',
    durationSeconds: 8,
    resolution: '1080p',
    generateAudio: true,
  },
});
```

**验收标准**: 
- 能基于首尾帧生成8秒视频
- 视频有音频
- 生成时间 < 3分钟

---

### 2.5 场景串联API ⏱️ 2天
**文件**: `server/api/scene/chain.post.ts`

- [ ] 实现 `generateSceneChain(scenes): Promise<SceneChain>`
- [ ] 上一场景尾帧 → 下一场景首帧 过渡
- [ ] 生成场景间转场视频 (使用首尾帧插值)
- [ ] 维护整体叙事连贯性

**验收标准**: 多个场景能平滑串联，转场自然

---

## Phase 3: 音频处理 (预计3天)

### 3.1 音频生成API ⏱️ 2天
**文件**: `server/api/audio/generate.post.ts`

- [ ] 集成 Lyria API 生成背景音乐 (需要通过 Live API WebSocket 实现)
- [ ] 使用 Gemini TTS (`gemini-2.5-flash` + `responseModalities: ['audio']`) 生成对话配音
- [ ] 为不同角色配置不同音色
- [ ] 情绪化语音调整

> ⚠️ 注意: Lyria 音乐生成需要通过 Live API (WebSocket) 使用，不能直接 REST API 调用

### 3.2 音频合成 ⏱️ 1天
- [ ] 对话音频时间轴对齐
- [ ] 背景音乐混音
- [ ] 音量均衡处理

---

## Phase 4: 后处理流水线 (预计3天)

### 4.1 视频合成 ⏱️ 2天
**文件**: `server/utils/ffmpeg.ts`

- [ ] 使用 `fluent-ffmpeg` 拼接视频片段
- [ ] 添加转场效果（淡入淡出）
- [ ] 叠加字幕
- [ ] 输出最终视频文件

### 4.2 生产流水线API ⏱️ 1天
**文件**: `server/api/pipeline/produce.post.ts`

- [ ] 整合所有API的完整流程
- [ ] WebSocket 进度推送
- [ ] 断点续传
- [ ] 错误恢复

---

## Phase 5: 前端页面开发 (预计1周)

### 5.1 页面路由 ⏱️ 2天 ✅ 已完成 (shadcn-vue)
**目录**: `app/pages/`

- [x] `index.vue` - 首页 (项目概览) - 使用 shadcn Card/Button 组件
- [x] `projects.vue` - 项目列表 - 使用 shadcn Card/Badge/Input 组件
- [ ] `projects/[id].vue` - 项目详情
- [x] `workbench.vue` - 剧本编辑工作台 - 使用 shadcn Card/Textarea/Badge 组件
- [x] `characters.vue` - 角色管理 - 使用 shadcn Card/Badge 组件
- [x] `video.vue` - 视频生成控制台 - 使用 shadcn Card/Switch 组件

### 5.2 核心组件 ⏱️ 3天
**目录**: `app/components/`

- [ ] `script/ScriptEditor.vue` - 剧本富文本编辑器
- [ ] `script/SceneCard.vue` - 场景卡片
- [ ] `character/CharacterCard.vue` - 角色卡片展示
- [ ] `character/ExpressionGrid.vue` - 表情网格
- [ ] `video/VideoPreview.vue` - 视频预览播放器
- [ ] `video/FramePair.vue` - 首尾帧对比展示
- [ ] `video/Timeline.vue` - 场景时间轴
- [ ] `video/ProgressBar.vue` - 生成进度条

### 5.3 Composables ⏱️ 2天
**目录**: `app/composables/`

- [ ] `useProject.ts` - 项目CRUD
- [ ] `useScript.ts` - 剧本解析调用
- [ ] `useCharacter.ts` - 角色生成调用
- [ ] `useVideoGen.ts` - 视频生成+轮询状态
- [ ] `useGemini.ts` - 通用Gemini调用封装

---

## Phase 6: 优化与上线 (预计1周)

### 6.1 性能优化
- [ ] 批量请求并发控制
- [ ] 中间结果缓存 (Nitro Storage)
- [ ] 使用 Veo 3.1 Fast 降低成本
- [ ] 失败重试策略

### 6.2 质量提升
- [ ] 提示词优化
- [ ] 角色一致性检测
- [ ] 视频质量评估

### 6.3 可观测性
- [ ] 日志系统 (Nuxt DevTools)
- [ ] 成本追踪
- [ ] 生成时间统计

---

## 技术风险

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| Veo API 生成慢 | 整体效率 | 并行生成多个场景，使用 Veo 3.1 Fast |
| 角色一致性差 | 观感体验 | 使用统一角色资产生成参考图+强约束提示词 |
| API 费用超支 | 成本 | 使用 Fast 版本，设置预算告警 |
| 首尾帧不匹配 | 视频跳跃 | 加强首尾帧生成的风格约束 |

---

## 里程碑

| 阶段 | 交付物 | 预计时间 |
|------|--------|----------|
| M1 | Nuxt项目搭建 + Gemini API连通 | Week 1 |
| M2 | 后端 API 完成 (剧本/角色/视频) | Week 2-3 |
| M3 | 前端页面 + 组件开发 | Week 4 |
| M4 | 完整流水线 + 联调 | Week 5 |
| M5 | 优化 + 部署上线 | Week 6 |

---

## 每日站会检查项

1. ✅ 昨天完成了什么？
2. 📋 今天计划做什么？
3. 🚧 有什么阻塞？
4. 💰 API 成本消耗情况
