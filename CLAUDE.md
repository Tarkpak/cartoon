# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

This repository centers on a single workbench flow:

`解析 -> 资产 -> 视频 -> 成片`

Historical prompt workflows are intentionally removed. When updating prompts, APIs, or settings, align changes to the current asset workbench instead of restoring legacy routes or compatibility aliases. If you find legacy flow references in docs or settings, update or remove them instead of preserving them for compatibility.

## Project Overview

**Playlet** is an AI-assisted video production system built with Vue 3 + Vite + Rust backend. The active product path is:

1. **Parse** — Parse source text into scenes, characters, and video-ready timeline descriptions.
2. **Assets** — Generate and manage reusable assets (character references, environment references).
3. **Videos** — Generate per-scene videos from timeline descriptions plus references.
4. **Final** — Merge scene videos into a final deliverable.

## Tech Stack

- **Framework**: Vue 3 Composition API + Vite
- **Package Manager**: Bun (registry: `registry.npmmirror.com` via `bunfig.toml`)
- **Database**: SQLite (`data/playlet.db`) via Rust `rusqlite`
- **UI**: Tailwind CSS (dark mode via `class`) + shadcn-vue (`new-york` style, `stone` base color)
- **State**: Pinia (registered but workbench state uses pure composable pattern, not stores)
- **AI Providers**: Google Gemini, Alibaba Qwen, Kling AI, Volcengine/Doubao (Seedance/Seedream)
- **Media Processing**: fluent-ffmpeg, Sharp
- **Rich Text Editor**: TipTap (for prompt editor / mention-based scene descriptions)
- **Validation**: Zod (shared between server and client via `shared/types/`)

## Common Commands

```bash
bun dev                   # Run Rust backend + Vite frontend in parallel
bun dev:backend           # Start only the Rust backend (cargo run --example playlet-backend)
bun dev:frontend          # Start only the Vite frontend
bun build                 # Production frontend build → .output/public
bun preview               # Run the Rust backend serving the built frontend

bun lint                  # vue-tsc --noEmit (alias of typecheck; ESLint config has no active rules)
bun typecheck             # vue-tsc --noEmit
bun test                  # Run vitest (watch mode)
bun test:coverage         # Run vitest with coverage

# Run a single test file or filter by name:
bun test app/lib/asset-workbench-api.test.ts
bun test -t "parses script"

# Desktop (Tauri) build & dev:
bun desktop:dev           # build frontend then `tauri dev`
bun desktop:build         # full desktop bundle with updater config

# Rust check without running:
cargo check --manifest-path src-tauri/Cargo.toml
```

Ports: Vite dev server runs on `:3000` and proxies `/api` to the Rust backend at `http://127.0.0.1:43127` (override with `RUST_BACKEND_URL`).

Tests live alongside the code they cover (`app/lib/*.test.ts`, `app/composables/*.test.ts`, `shared/types/*.test.ts`). `bun lint`/`bun lint:fix` are both just `vue-tsc --noEmit` — there is no ESLint-based formatting step despite `eslint.config.mjs` existing (its rule set is empty). Match surrounding style manually; the codebase convention is no trailing commas, 2-space indent.

## Architecture

### Rust Backend

- Backend runtime is implemented in Rust under `src-tauri/src/backend.rs` and split modules in `src-tauri/src/backend/`.
- Frontend APIs remain `/api/*`, and they are served by Axum handlers.
- `bun preview` and desktop runtime both rely on the Rust backend entrypoint (`playlet-backend` / embedded Tauri startup).

### Prompt Template System

- **Storage**: `system_config` table, keys `prompt_templates_default`, `prompt_versions_default`, `prompt_profile_state_default`。
- **Auto-sync behavior**: Non-customized templates are refreshed from Rust-side defaults; customized templates (`isCustomized: true`) preserve user content.
- **Interpolation**: `getInterpolatedPrompt(id, variables)` does `{{variable}}` substitution.
- **Bilingual**: Each template has `{ zh: string, en: string }` content. Language is configurable per template.
- **Version history**: Up to 20 versions per template.

### API Endpoint Pattern

Rust handlers keep the same contract-driven flow:
1. Parse/validate request payload
2. Build workflow prompt variables
3. Resolve prompt template and model selection
4. Call provider runtime
5. Normalize response JSON

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

Database initialization and bootstrap are handled in Rust startup (`start_server` + helper functions in `backend.rs` / split modules).

### Path Aliases & Auto-Imports

Vite aliases (`vite.config.ts`):
- `@` and `~` → `app/`
- `#shared` → `shared/`

Auto-imported (no manual import needed):
- Vue, vue-router, and pinia APIs, plus `$fetch` from `ofetch` (`unplugin-auto-import`, declared in `auto-imports.d.ts`).
- Everything under `app/composables/` (auto-import) and `app/components/` (auto-registered with directory namespacing; UI primitives under the `ui` namespace — see `components.d.ts`).

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

- 项目已移除 `workflowType` 概念，提示词与项目流程统一按当前资产工作台默认流程执行。
- 供应商凭证（gemini/qwen/volcengine/deepseek/kling）与 TOS 云存储均在客户端「设置 → 模型供应商 / 云存储」中配置，持久化到 SQLite `system_config`（keys `provider_credentials`、`tos_storage_config`、`custom_openai_provider`）。不再从环境变量读取。
- Gemini API Key 支持多 key 轮换（在设置表单内用逗号/分号/换行分隔）。
- TOS cloud storage is opt-in (在设置中开启并填写完整凭证)。Without it, media files are stored locally.
- Gemini video generation uses a separate code path (`/api/video/generate`) from the unified `generateVideo()` API.
- This is a Tauri desktop app, not a server deployment. The frontend is static (`.output/public`); all backend logic runs in the embedded Rust process. There is no Nitro/PM2/Node server.
- CI/CD: `.github/workflows/desktop-release.yml` builds and publishes desktop bundles, triggered on **git tag push** (use `bun run release` to cut a version and tag). It does not deploy on `master` push.
- Rust backend (`src-tauri/src/backend.rs`, ~6.6k lines) is served via Axum on `/api/*` and split into `model_constraints`, `prompts_api`, and `runtime_api` submodules under `src-tauri/src/backend/`. The standalone dev entrypoint is the `playlet-backend` cargo example.
