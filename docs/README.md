# AI漫剧生成系统 (Manju)

> 基于 **Nuxt.js 4** + **Google Gemini API** 的 AI 漫剧全栈生成平台

## 🎯 项目简介

将小说/剧本文本自动转换为动漫风格短视频，核心技术基于 Google Veo 3.1 的**首尾帧插值**功能。

## 🛠 技术栈

| 层级 | 技术 |
|------|------|
| **全栈框架** | Nuxt.js 4.2.1 (Vue 3 + Nitro) |
| **UI** | Nuxt UI 3 + Tailwind CSS |
| **状态管理** | Pinia |
| **AI视频** | Google Veo 3.1 (首尾帧) |
| **AI图片** | Nano Banana Pro |
| **AI文本** | Gemini 3 Pro |
| **AI音频** | Lyria |

## 📁 项目结构

```
manju/
├── app/                      # 前端 (Vue 3)
│   ├── pages/                # 页面路由
│   ├── components/           # 组件
│   ├── composables/          # 组合式函数
│   └── layouts/              # 布局
├── server/                   # 后端 (Nitro)
│   ├── api/                  # API 路由
│   └── utils/                # 服务端工具
├── shared/                   # 前后端共享
│   └── types/                # 类型定义
├── nuxt.config.ts            # Nuxt 配置
└── package.json
```

## 🚀 快速开始

```bash
# 安装依赖
pnpm install

# 配置环境变量
cp .env.example .env
# 编辑 .env 填入 GEMINI_API_KEY

# 开发模式
pnpm dev

# 构建
pnpm build

# 预览生产版本
pnpm preview
```

## 📖 文档

- [技术需求文档](./AI漫剧技术需求文档.md)
- [开发任务清单](./TASKS.md)

## 🔗 API 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/script/parse` | 解析剧本 |
| POST | `/api/character/generate` | 生成角色 |
| POST | `/api/video/generate` | 生成视频 |
| GET | `/api/video/status/:id` | 查询状态 |
| POST | `/api/audio/generate` | 生成音频 |

## 📄 License

MIT
