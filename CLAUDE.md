# CLAUDE.md

This repository now centers on a single workbench flow:

`解析 -> 资产 -> 视频 -> 成片`

Historical prompt workflows are intentionally removed. When updating prompts, APIs, or settings, align changes to the current asset workbench instead of restoring legacy routes or compatibility aliases.

## Project Overview

**Manju** is an AI-assisted video production system built with Nuxt.js 4. The active product path is:

1. Parse source text into scenes, characters, and video-ready timeline descriptions.
2. Generate and manage reusable assets such as character references and environment references.
3. Generate per-scene videos from timeline descriptions plus references.
4. Merge scene videos into a final deliverable.

## Tech Stack

- **Framework**: Nuxt.js 4 + Vue 3 Composition API
- **Package Manager**: Bun
- **Database**: SQLite + Drizzle ORM
- **UI**: Tailwind CSS + shadcn-vue
- **AI Providers**: Google Gemini, Alibaba Qwen, Volcengine/Doubao
- **Media Processing**: FFmpeg, Sharp

## Current Directory Focus

```text
app/
  pages/
    asset-workbench.vue      # Main workbench
    settings.vue             # Prompt/model/style settings
  components/
    asset-workbench/         # Parse/assets/videos/final stage UI
    settings/                # Prompt center and workflow model settings
    prompt-editor/           # Prompt editing UI
  composables/
    useAssetWorkbench*.ts    # Workbench state and actions
    useSettingsPrompts.ts    # Prompt center data loading/grouping
    useSettingsWorkflowModels.ts

server/
  api/
    script/parse.post.ts
    character/generate.post.ts
    asset-workflow/reference/generate.post.ts
    asset-workflow/scene/description-refinement.post.ts
    asset-workflow/video/generate.post.ts
    video/merge.post.ts
    prompts/*                # Prompt template CRUD/reset/version APIs
    models/*                 # Model catalog, workflow model settings, tests
  utils/
    prompt-template.ts
    prompt-defaults.ts
    workflow-model.ts
    model-provider.ts

shared/
  types/
    prompt-template.ts
    workflow-models.ts
    project.ts
```

## Workflow Rules

### 1. Prompt Center

Only the following prompt templates belong to the active workbench flow:

- `script_parsing`
- `character_sheet`
- `character_regeneration`
- `environment_reference_generation`
- `scene_description_refinement`
- `scene_video_generation`

Prompt grouping in settings should follow the current stages:

- `parse`
- `assets`
- `videos`

Do not reintroduce any historical prompt IDs or deprecated workflow aliases.

### 2. Workflow Model Settings

Workflow model configuration is current-flow-only. Valid workflow steps are:

- `script_parsing`
- `scene_description_refinement`
- `text_translation`
- `character_portrait`
- `frame_generation`
- `video_generation`

The settings UI may still group these by model type (`text`, `image`, `video`) for global defaults, but the configured steps must remain aligned with the active workbench flow.

### 3. API Naming

Prefer current-flow API names. Example:

- use `/api/asset-workflow/scene/description-refinement`
- do not restore `/api/asset-workflow/scene/refine-description`

When renaming routes or workflow identifiers, update both the server endpoint and the frontend caller in the same change.

## Key Architectural Notes

- Prompt templates are stored in `system_config` and exposed through `server/api/prompts/*`.
- Workflow model overrides are stored separately from global model defaults.
- Scene description refinement is a real prompt-template-backed workflow, not an inline hardcoded prompt.
- Environment reference generation replaces the old first-frame-style prompt semantics in the prompt center.
- Final composition is handled by `/api/video/merge` after scene-level video generation completes.

## Common Commands

```bash
bun dev
bun build
bun preview

bun db:generate
bun db:migrate
bun db:push

bun lint
bun lint:fix
bun typecheck
bun test
```

## Working Expectations

- Prefer `rg` for search.
- Use `apply_patch` for manual code edits.
- The worktree may already contain user changes; do not revert unrelated edits.
- If you find legacy flow references in docs or settings, update or remove them instead of preserving them for compatibility.
