# 0002: Migrate to Astro SSR and app-core

Status: Accepted direction. Implementation remains pending in the linked issues.

## Context

Main runs Next.js in `web/`, including UI, API routes, and keeper libraries.
The selected migration must preserve those behaviors and URLs.

## Decision

Create `frontend/` using Astro SSR with the Node adapter. Reuse React islands for
MapLibre, wallet providers, and World verification; keep providers within each
hydrated tree. Retain reused Solid marketplace islands with explicit include paths.
Move server libraries into `packages/app-core/` and expose them through Astro endpoints.

## Consequences

Keep `web/` available until route parity, persistence, and rollback are verified.
Port `/map`, `/donate`, `/verify/[eventId]`, `/liff`, `/coop`, and `/holder` without
moving server secrets into browser bundles. Storybook uses production components.
The target directories are not claimed as implemented by this ADR.

## Evidence

[Current runtime](../../web/package.json), [current server libraries](../../web/src/lib),
[#56](https://github.com/reeldeal-xyz/reeldeal/issues/56),
[#58](https://github.com/reeldeal-xyz/reeldeal/issues/58),
[#63](https://github.com/reeldeal-xyz/reeldeal/issues/63),
[#71](https://github.com/reeldeal-xyz/reeldeal/issues/71),
[team plan at review](https://github.com/reeldeal-xyz/reeldeal/blob/6ad7eea69214ca5aef51a36b2f263ed5b0c7b16d/README.md).
