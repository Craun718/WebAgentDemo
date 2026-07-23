# web-agent

A moon-managed pnpm monorepo with a Hono (Node) backend and a Vite 8 + Vue 3 frontend, sharing TypeScript types via a workspace package.

## Layout

- `packages/shared` — shared TS types and helpers, consumed from source (no build step).
- `apps/backend` — Hono API on Node (`@hono/node-server`), `tsx` dev, `tsup` build.
- `apps/frontend` — Vite 8 + Vue 3 SPA with vue-router and pinia.

## Prerequisites

- Node >= 26
- pnpm (pinned via `packageManager` in the root `package.json`)

moon is a workspace devDependency, so invoke it through pnpm (`pnpm moon ...` or the scripts below).

## Getting started

```sh
pnpm install
```

### Develop (runs backend :3000 and frontend :5000 in parallel)

```sh
pnpm dev
```

The Vite dev server proxies `/api` to `http://127.0.0.1:3000`.

### Lint / typecheck / test / build (across all projects)

```sh
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

These run moon against all projects; e.g. `pnpm moon run frontend:dev` targets a single project.

## Notes

- Shared types flow through the `@web-agent/shared` workspace package; both apps import `HealthResponse` directly from source.
- Tooling: oxlint (linting), Vitest (testing), TypeScript in `bundler` module resolution.
