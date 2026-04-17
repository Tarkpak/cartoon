# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

This repository centers on a single workbench flow:

`解析 -> 资产 -> 视频 -> 成片`

Historical prompt workflows are intentionally removed. When updating prompts, APIs, or settings, align changes to the current asset workbench instead of restoring legacy routes or compatibility aliases. If you find legacy flow references in docs or settings, update or remove them instead of preserving them for compatibility.

## Project Overview

**Manju** is an AI-assisted video production system built with Nuxt.js 4. The active product path is:

1. **Parse** — Parse source text into scenes, characters, and video-ready timeline descriptions.
2. **Assets** — Generate and manage reusable assets (character references, environment references).
3. **Videos** — Generate per-scene videos from timeline descriptions plus references.
4. **Final** — Merge scene videos into a final deliverable.

## Tech Stack

- **Framework**: Nuxt.js 4 + Vue 3 Composition API (`compatibilityDate: '2025-01-15'`)
- **Package Manager**: Bun (registry: `registry.npmmirror.com` via `bunfig.toml`)
- **Database**: SQLite (`data/manju.db`) + Drizzle ORM + better-sqlite3
- **UI**: Tailwind CSS (dark mode via `class`) + shadcn-vue (`new-york` style, `stone` base color)
- **State**: Pinia (registered but workbench state uses pure composable pattern, not stores)
- **AI Providers**: Google Gemini, Alibaba Qwen, Kling AI, Volcengine/Doubao (Seedance/Seedream)
- **Media Processing**: fluent-ffmpeg, Sharp
- **Rich Text Editor**: TipTap (for prompt editor / mention-based scene descriptions)
- **Validation**: Zod (shared between server and client via `shared/types/`)

## Common Commands

```bash
bun dev                   # Start dev server
bun build                 # Production build
bun preview               # Preview production build

bun db:generate           # Generate Drizzle migration files
bun db:migrate            # Run migrations
bun db:push               # Push schema directly (dev)
bun db:studio             # Open Drizzle Studio UI

bun lint                  # Lint check
bun lint:fix              # Lint and auto-fix
bun typecheck             # vue-tsc type checking
bun test                  # Run vitest
bun test:coverage         # Run vitest with coverage
```

Note: vitest is configured but no test files currently exist in the project.

## Architecture

### Two-Layer AI Abstraction

The AI integration has two distinct layers — understanding this separation is critical:

1. **`server/utils/model-provider.ts`** — Global provider abstraction. Contains the static model registry (`TEXT_MODELS`, `IMAGE_MODELS`, `VIDEO_MODELS`, `VOICE_MODELS`) and unified dispatch functions (`generateText`, `generateJSON`, `generateImage`, `generateVideo`). Global default model selections are stored in `system_config` under key `'selected_models'`.

2. **`server/utils/workflow-model.ts`** — Per-workflow-step model resolution. `getWorkflowModel(step)` reads per-step overrides from DB, falling back to global defaults. `generateTextForWorkflow(step, options)` and `generateJSONForWorkflow(step, options)` resolve the model for a given workflow step, then dispatch to the provider layer. Always reads fresh from DB (no in-memory cache).

### Prompt Template System

- **Storage**: `system_config` table, keys `prompt_templates_asset_consistency`, `prompt_versions_asset_consistency`, `prompt_lang_config_asset_consistency`.
- **Auto-sync behavior**: Non-customized templates get their `content` auto-updated from `server/utils/prompt-defaults.ts` on every read. Customized templates (`isCustomized: true`) preserve user content but still sync metadata (name, description, variables) from defaults.
- **Interpolation**: `getInterpolatedPrompt(id, variables, lang, workflow)` does `{{variable}}` substitution.
- **Bilingual**: Each template has `{ zh: string, en: string }` content. Language is configurable per template.
- **Version history**: Up to 20 versions per template.

### API Endpoint Pattern

Server endpoints follow a consistent pattern (see `description-refinement.post.ts` as canonical example):
1. Parse request body with Zod
2. Build prompt variables from structured input
3. Call `getInterpolatedPrompt()` with the template ID
4. Call `generateTextForWorkflow()` or `generateJSONForWorkflow()` with the workflow step
5. Validate response with Zod
6. Return normalized result

### Frontend State: Composable Decomposition

The workbench page uses a **pure composable pattern** (not Pinia stores). `useAssetWorkbench.ts` is the orchestrator that wires together ~15 sub-composables:

- `useAssetWorkbenchProjectIO` — project load/save
- `useAssetWorkbenchGeneration` — AI generation calls (parse, character, batch)
- `useAssetWorkbenchPageState` — derived state, asset maps, queue management
- `useAssetWorkbenchSceneEditing` — scene CRUD
- `useAssetWorkbenchSceneGeneration` — scene video generation
- `useAssetWorkbenchSceneChat` — per-scene chat interaction
- `useAssetWorkbenchAutoFlow` — automated multi-step generation
- `useAssetWorkbenchCharacterActions` — character asset management
- `useAssetWorkbenchAssetMedia` — asset media upload/management

### `app/lib/` — Client Utility Layer

Large utility library (`app/lib/asset-workbench-*.ts`) containing pure functions for API calls, type definitions, mention tokenization, scene reference resolution, project serialization, and progress tracking. Composables in `app/composables/` delegate to these utilities. When adding new workbench logic, check `app/lib/` first for existing helpers.

### Database Initialization

The DB uses a hybrid approach: `server/db/index.ts` runs `CREATE TABLE IF NOT EXISTS` statements plus inline column-addition guards (not pure Drizzle migrations). The Nitro plugin `server/plugins/db.ts` calls `initDatabase()` + `initializeSelectedModels()` on server startup. Schema is defined in `server/db/schema.ts`.

### Path Aliases

- `#shared` → `shared/` (Nuxt 4 auto-alias for the `shared/` directory)
- `@/components/*` → `app/components/*` (standard Nuxt)

## Workflow Rules

### 1. Prompt Center

Only the following prompt templates belong to the active workbench flow:

- `script_parsing`
- `character_sheet`
- `character_regeneration`
- `environment_reference_generation`
- `scene_description_refinement`
- `scene_video_generation`

Prompt grouping in settings follows the current stages: `parse`, `assets`, `videos`.

Do not reintroduce any historical prompt IDs or deprecated workflow aliases.

### 2. Workflow Model Settings

Valid workflow steps (Zod enum in `shared/types/workflow-models.ts`):

- `script_parsing`
- `scene_description_refinement`
- `text_translation`
- `character_portrait`
- `frame_generation`
- `video_generation`

The settings UI groups these by model type (`text`, `image`, `video`) for global defaults, but the configured steps must remain aligned with the active workbench flow.

### 3. API Naming

Prefer current-flow API names. Example:

- use `/api/asset-workflow/scene/description-refinement`
- do not restore `/api/asset-workflow/scene/refine-description`

When renaming routes or workflow identifiers, update both the server endpoint and the frontend caller in the same change.

## Key Architectural Constraints

- Only one `PROJECT_WORKFLOW_TYPES` value exists: `asset_consistency`. `normalizeProjectWorkflowType()` always returns this.
- `GEMINI_API_KEY` supports multi-key rotation (comma/semicolon/newline-separated).
- TOS cloud storage is opt-in (`TOS_ENABLED=true`). Without it, media files are stored locally.
- Gemini video generation uses a separate code path (`/api/video/generate`) from the unified `generateVideo()` API.
- Nitro experimental features enabled: `asyncContext` and `websocket`.
- ESLint stylistic rules: `commaDangle: 'never'`, `braceStyle: '1tbs'`. No Prettier — ESLint handles formatting.
- Production deploys via PM2 (`ecosystem.config.cjs`) on port 4000, CI/CD through GitHub Actions on `master` push.
