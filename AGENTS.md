# Repository Guidelines

## Project Structure & Module Organization
- `app/`: Nuxt frontend code.
- `app/pages/`: route-level pages.
- `app/components/`: reusable UI and feature components (`PascalCase.vue`).
- `app/composables/`: reusable state/logic hooks (`useXxx.ts`).
- `app/lib/`: client-side helper modules.
- `server/`: Nitro backend.
- `server/api/`: API routes named by method suffix (for example, `create.post.ts`, `[id].get.ts`).
- `server/utils/`: provider/service integrations.
- `server/db/`: Drizzle schema and SQL migrations.
- `shared/`: shared types/constants used by app and server.
- `public/`: static assets; `data/`: runtime/project data; `scripts/`: automation; `docs/`: documentation.
- `.nuxt/` and `.output/` are generated artifacts; do not edit them directly.

## Build, Test, and Development Commands
Use Bun (Node `>=20`).
- `bun install`: install dependencies.
- `bun dev`: start local Nuxt dev server.
- `bun build`: build production output.
- `bun preview`: preview the production build locally.
- `bun lint` / `bun lint:fix`: run/fix ESLint checks.
- `bun typecheck`: run Nuxt TypeScript checks.
- `bun test` / `bun test:coverage`: run Vitest and coverage.
- `bun db:generate`, `bun db:migrate`, `bun db:push`, `bun db:studio`: manage Drizzle migrations and schema.

## Coding Style & Naming Conventions
- TypeScript-first, Vue SFCs with `<script setup lang="ts">`.
- 2-space indentation; stylistic rules come from Nuxt ESLint config (no trailing commas).
- Use `camelCase` for variables/functions, `PascalCase` for components, and `useXxx` for composables.
- Validate API inputs with Zod in `server/api` handlers.

## Testing Guidelines
- Framework: Vitest.
- Add tests for new logic; preferred names are `*.test.ts` or `*.spec.ts`.
- Place tests near the feature/module they verify.
- For API/composable changes, cover at least one success path and one edge/error path.
- No strict coverage threshold is enforced; use `bun test:coverage` to track impact for touched modules.

## Commit & Pull Request Guidelines
- Follow Conventional Commit style used in history: `feat:`, `refactor:`, `fix:`, `chore:`.
- Example: `feat: add style preset import validation`.
- PRs should include purpose, linked issue/task, and screenshots for UI changes.
- Note any `.env`, migration, or deployment impact explicitly.
- Run `bun lint`, `bun typecheck`, and relevant tests before opening/merging.
- Deploy workflow runs on push to `master`; prefer reviewed PR merges over direct pushes.

## Security & Configuration Tips
- Copy `.env.example` to `.env` and keep secrets local.
- Never commit provider API keys or deployment credentials.
