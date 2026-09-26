# 0002: Migrate to Astro SSR and app-core

Status: Accepted direction. Foundation merged in #88; production migration remains pending.

## Context

Main retains Next.js in `web/`, including UI, API routes, and keeper libraries.
PR #88 added `frontend/` with Astro SSR and Storybook. Its legacy-page catch-all
redirects to `web/`; it does not proxy APIs. Production migration must preserve
the existing behaviors and URLs.

## Decision

Create `frontend/` using Astro SSR with the Node adapter. Reuse React islands for
MapLibre, wallet providers, and World verification; keep providers within each
hydrated tree. Retain reused Solid marketplace islands with explicit include paths.
Move server libraries into `packages/app-core/` and expose them through Astro endpoints.

## Consequences

Keep `web/` available until route parity, persistence, and rollback are verified.
Port `/donate`, `/verify/[eventId]`, `/liff`, `/coop`, and `/holder` without
moving server secrets into browser bundles. Storybook uses production components.
`/map` is retired, not ported: the Astro app's native `/hmi` supersedes it, and
`web/`'s homepage, nav brand link, and `frontend/`'s own `/map` all redirect to
`/hmi` instead. The frontend foundation is implemented; `packages/app-core/` and
production route parity are not claimed as complete.

## Evidence

[Current runtime](../../web/package.json), [current server libraries](../../web/src/lib),
[frontend foundation](../../frontend/README.md),
[#88](https://github.com/reeldeal-xyz/reeldeal/pull/88),
[#56](https://github.com/reeldeal-xyz/reeldeal/issues/56),
[#58](https://github.com/reeldeal-xyz/reeldeal/issues/58),
[#63](https://github.com/reeldeal-xyz/reeldeal/issues/63),
[#71](https://github.com/reeldeal-xyz/reeldeal/issues/71),
[team plan at review](https://github.com/reeldeal-xyz/reeldeal/blob/6ad7eea69214ca5aef51a36b2f263ed5b0c7b16d/README.md).
