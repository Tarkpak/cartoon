# Repository Guidelines

## Project Structure & Module Organization
- app/ contains the Vue 3 + Vite frontend: app/pages/ for routes, app/components/ for PascalCase.vue components, app/composables/ for useXxx.ts hooks, and app/lib/ for helpers.
- src-tauri/src/ contains the Rust backend and Tauri runtime. Backend APIs are organized in src-tauri/src/backend*.rs and src-tauri/src/backend/.
- shared/ stores cross-boundary types and utilities. public/ stores assets, docs/ holds docs, and scripts/ automation.
- Do not edit generated artifacts such as .output/, .nuxt/, generated *.d.ts files, or src-tauri/target*.

## Build, Test, and Development Commands
Use Bun. Node >=20.

- bun install: install dependencies.
- bun run dev: start the Vite frontend and Rust backend.
- bun run dev:frontend: run only the frontend.
- bun run dev:backend: run only the backend on 127.0.0.1:43127.
- bun run build: create the production web build.
- bun run preview: preview output through the Rust backend.
- bun run desktop:dev: run the Tauri app locally.
- bun run desktop:build: build the desktop package.
- bun run lint / bun run lint:fix: run or fix ESLint.
- bun run typecheck: run Vue TypeScript checks.
- bun run test / bun run test:coverage: run the frontend Vitest suite and backend Bun tests.
- cargo check --manifest-path src-tauri/Cargo.toml: check Rust code.

## Coding Style & Naming Conventions
- Prefer TypeScript and Vue SFCs with script setup lang=ts.
- Use 2-space indentation and follow existing ESLint rules.
- Use camelCase for variables/functions, PascalCase for components, and useXxx for composables.
- Keep frontend logic in app/ and Rust changes within the src-tauri/src/ layout.

## Testing Guidelines
- Use Vitest for frontend and shared TypeScript logic.
- Name tests *.test.ts or *.spec.ts and place them near the tested module.
- For composables, helpers, and API-facing logic, cover one success path and one edge or error path.
- Run bun run test for normal validation; use bun run test:coverage when coverage impact matters.

## Commit & Pull Request Guidelines
- Follow the Conventional Commit style used in history: feat:, fix:, refactor:, and chore:.
- Example: feat: add style preset import validation.
- PRs should describe purpose, link the issue or task, and include screenshots for UI changes.
- Note any .env, migration, deployment, or desktop packaging impact.
- Before merging, run bun run lint, bun run typecheck, and relevant tests.

## Security & Configuration Tips
- Copy .env.example to .env for local setup.
- Never commit provider API keys, TOS credentials, deployment tokens, or other secrets.
- Deployment runs on push to master; prefer reviewed PR merges over direct pushes.
