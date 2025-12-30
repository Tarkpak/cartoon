# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Manju** is an AI-powered manga/video generation system built with Nuxt.js 4. It automates the creation of animated manga content from story ideas or scripts using multiple AI providers (Google Gemini, Alibaba Qwen, Volcengine/Doubao).

## Tech Stack

- **Framework**: Nuxt.js 4 with Vue 3 Composition API
- **Package Manager**: Bun (v1.2.15)
- **Database**: SQLite with Drizzle ORM
- **UI**: Tailwind CSS + shadcn-vue (Radix Vue primitives)
- **State Management**: Vue Composables (not Pinia stores)
- **AI Providers**: Google Gemini, Alibaba Qwen (DashScope), Volcengine (Doubao)
- **Video Processing**: FFmpeg (via fluent-ffmpeg)

## Directory Structure

```
/
├── app/                      # Frontend (Nuxt app directory)
│   ├── components/           # Vue components
│   │   ├── ui/              # shadcn-vue base components (Button, Card, Dialog, etc.)
│   │   ├── workbench/       # Main workbench panels (OutlinePanel, CharacterPanel, etc.)
│   │   ├── character/       # Character-related components
│   │   ├── script/          # Script editing components
│   │   └── video/           # Video preview components
│   ├── composables/         # Vue composables (state management)
│   │   ├── useWorkbench.ts  # Main workbench state (scenes, characters, generation)
│   │   ├── useProject.ts    # Project CRUD operations
│   │   ├── usePipeline.ts   # Pipeline task management with WebSocket
│   │   └── ...
│   ├── pages/               # Route pages
│   │   ├── index.vue        # Landing page
│   │   ├── projects.vue     # Project list
│   │   ├── workbench.vue    # Main generation workbench
│   │   └── settings.vue     # Settings page
│   ├── layouts/             # Page layouts
│   └── lib/utils.ts         # Utility functions (cn, etc.)
│
├── server/                   # Backend (Nitro server)
│   ├── api/                 # API endpoints (file-based routing)
│   │   ├── project/         # Project CRUD
│   │   ├── scene/           # Scene generation, chaining
│   │   ├── character/       # Character extraction, generation
│   │   ├── video/           # Video generation, merging
│   │   ├── frame/           # First/last frame generation
│   │   ├── outline/         # Story outline generation
│   │   ├── prompts/         # Prompt template management
│   │   ├── storyboard/      # Storyboard generation
│   │   └── audio/           # Audio/TTS generation
│   ├── db/                  # Database
│   │   ├── index.ts         # Drizzle instance + SQLite setup
│   │   ├── schema.ts        # Table definitions
│   │   └── migrations/      # Drizzle migrations
│   ├── utils/               # Server utilities
│   │   ├── gemini.ts        # Google Gemini API client
│   │   ├── qwen.ts          # Alibaba Qwen API client
│   │   ├── volcengine.ts    # Volcengine/Doubao API client
│   │   ├── model-provider.ts # Unified model provider abstraction
│   │   ├── prompt-template.ts # Prompt template system
│   │   ├── prompt-defaults.ts # Default prompt templates
│   │   ├── ffmpeg.ts        # Video processing utilities
│   │   ├── concurrency.ts   # Rate limiting
│   │   ├── websocket.ts     # WebSocket for real-time updates
│   │   └── logger.ts        # Logging utilities
│   ├── plugins/             # Nitro plugins
│   └── routes/              # Custom routes (WebSocket)
│
├── shared/                   # Shared code (frontend + backend)
│   └── types/               # TypeScript type definitions
│       ├── video.ts         # Video generation types
│       ├── character.ts     # Character types
│       ├── outline.ts       # Story outline types
│       ├── storyboard.ts    # Storyboard types
│       ├── styles.ts        # Art style presets (30+ styles)
│       ├── provider.ts      # AI provider types
│       ├── prompt-template.ts # Prompt template types
│       └── ...
│
├── data/                     # Runtime data
│   └── manju.db             # SQLite database file
│
├── nuxt.config.ts           # Nuxt configuration
├── drizzle.config.ts        # Drizzle ORM configuration
└── tailwind.config.js       # Tailwind CSS configuration
```

## Key Architectural Patterns

### 1. Workflow Steps

The main workbench follows a 4-step workflow:
1. **Outline** - Generate story outline from idea OR parse existing script
2. **Characters** - Extract and generate character designs
3. **Script** - Generate detailed scenes with dialogues
4. **Video** - Generate frames and videos for each scene

### 2. State Management

Uses Vue Composables instead of Pinia stores. The main composable is `useWorkbench.ts` which manages:
- Project metadata (name, style, aspect ratio)
- Story outline and scenes
- Characters and their assets
- Generation status for frames/videos
- Pipeline progress

### 3. Multi-Provider AI System

The `model-provider.ts` provides a unified interface for:
- **Text Generation**: Gemini, Qwen, Volcengine (for outlines, scripts, prompts)
- **Image Generation**: Gemini, Qwen Wanx, Volcengine (for character art, frames)
- **Video Generation**: Gemini Veo, Qwen Wanx, Volcengine (for scene videos)
- **TTS**: Qwen TTS (for narration)

### 4. Prompt Template System

Customizable prompts stored in database with:
- Bilingual support (Chinese/English)
- Variable interpolation (`{{variable}}`)
- Version history
- Per-template language configuration

### 5. API Naming Convention

Server API files use Nuxt's file-based routing:
- `[id].get.ts` - GET /api/[parent]/[id]
- `[id].put.ts` - PUT /api/[parent]/[id]
- `create.post.ts` - POST /api/[parent]/create
- `list.get.ts` - GET /api/[parent]/list

## Database Schema

Main tables (SQLite with Drizzle ORM):
- `projects` - Project metadata with style/aspect ratio presets
- `scripts` - Raw text and parsed script data
- `scenes` - Individual scenes with frames, video URLs, storyboard data
- `characters` - Character definitions with base images and expressions
- `video_tasks` - Async video generation task tracking
- `generated_videos` - Completed video metadata
- `system_config` - Key-value config storage (prompt templates, etc.)

## Common Commands

```bash
# Development
bun dev                    # Start dev server

# Build
bun build                  # Build for production
bun preview                # Preview production build

# Database
bun db:generate            # Generate Drizzle migrations
bun db:migrate             # Run migrations
bun db:push                # Push schema changes
bun db:studio              # Open Drizzle Studio

# Code Quality
bun lint                   # Run ESLint
bun lint:fix               # Fix ESLint issues
bun typecheck              # Run TypeScript check
bun test                   # Run Vitest tests
```

## Environment Variables

Required in `.env`:
```
GEMINI_API_KEY=            # Google Gemini API key
QWEN_API_KEY=              # Alibaba Qwen (DashScope) API key
VOLCENGINE_API_KEY=        # Volcengine (Doubao) API key

# Optional
HTTP_PROXY=                # Proxy for Gemini (needed in China)
HTTPS_PROXY=
OUTPUT_DIR=./output
MAX_CONCURRENT_REQUESTS=3
DAILY_BUDGET_LIMIT=50
```

## Key Files to Understand

1. **`app/composables/useWorkbench.ts`** - Central state management, all generation logic
2. **`server/utils/model-provider.ts`** - Multi-provider AI abstraction
3. **`server/utils/gemini.ts`** - Gemini API client with retry logic
4. **`server/db/schema.ts`** - Database schema definitions
5. **`shared/types/styles.ts`** - 30+ art style presets
6. **`app/pages/workbench.vue`** - Main workbench UI

## Generation Pipeline

1. **Story Idea** → `POST /api/outline/generate` → **Story Outline**
2. **Outline** → `POST /api/character/extract-from-outline` → **Characters**
3. **Characters** → `POST /api/character/generate` → **Character Images**
4. **Outline + Characters** → `POST /api/scene/generate-from-outline` → **Scenes**
5. **Scene** → `POST /api/frame/generate` → **First/Last Frames**
6. **Frames** → `POST /api/video/generate` → **Scene Video**
7. **All Videos** → `POST /api/video/merge` → **Final Video**

## Important Rules

- **Prompt Template Sync**: When modifying `server/utils/prompt-defaults.ts`, the changes must be synced to the database. Users need to reset prompts via the settings page, or the database `system_config` table needs to be updated to reflect the new default templates.

## Notes

- The project uses Chinese comments extensively
- WebSocket support for real-time pipeline progress updates (`server/routes/_ws.ts`)
- Supports multiple aspect ratios: 16:9, 9:16, 1:1
- Video generation is async with task polling
