#!/usr/bin/env bash
# Build and (re)start the web container, then check /health reports this commit. Used by deploy-web.yml
# and by hand. GIT_SHA defaults to the checked-out commit.
set -euo pipefail
cd "$(dirname "$0")/.."
export GIT_SHA="${GIT_SHA:-$(git rev-parse HEAD)}"
docker network inspect reeldeal >/dev/null 2>&1 || docker network create reeldeal >/dev/null
docker compose up -d --build --wait --quiet-pull web
commit=$(docker compose exec -T web node -e "fetch('http://127.0.0.1:4321/health').then(r => r.json()).then(h => console.log(h.commit))")
[ "$commit" = "$GIT_SHA" ] || { echo "web: /health reports '$commit', expected $GIT_SHA" >&2; exit 1; }
echo "web: healthy at $commit"
