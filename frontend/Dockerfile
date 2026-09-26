# syntax=docker/dockerfile:1
# Astro SSR (Node adapter, standalone). Build context is the repo root (bun.lock lives there):
#   docker compose -f frontend/docker-compose.yml build
FROM oven/bun:1.3.14@sha256:e10577f0db68676a7024391c6e5cb4b879ebd17188ab750cf10024a6d700e5c4 AS bun

FROM node:24-slim@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6 AS build
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
WORKDIR /repo
# Every workspace manifest, so the frozen lockfile resolves; only the frontend's deps are installed.
COPY package.json bun.lock ./
COPY packages/shared/package.json packages/shared/
COPY web/package.json web/
COPY frontend/package.json frontend/
RUN bun install --frozen-lockfile --filter @repo/frontend
COPY frontend/ frontend/
COPY packages/shared/src/ packages/shared/src/
RUN cd frontend && bun run build

# Runtime dependencies only (no Storybook, check or type packages).
FROM build AS deps
RUN rm -rf node_modules frontend/node_modules \
 && bun install --frozen-lockfile --production --filter @repo/frontend \
 && mkdir -p frontend/node_modules

FROM node:24-slim@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6
WORKDIR /repo
ENV NODE_ENV=production HOST=0.0.0.0 PORT=4321
# Bun's isolated layout: packages live in node_modules/.bun, linked from each workspace's node_modules.
COPY --from=deps /repo/node_modules node_modules
COPY --from=deps /repo/frontend/node_modules frontend/node_modules
COPY --from=build /repo/frontend/dist frontend/dist
COPY frontend/package.json frontend/
ARG GIT_SHA=
ENV GIT_SHA=${GIT_SHA}
USER node
EXPOSE 4321
HEALTHCHECK --interval=10s --timeout=5s --start-period=20s --retries=5 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:4321/health').then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "frontend/dist/server/entry.mjs"]
