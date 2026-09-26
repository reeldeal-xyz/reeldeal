#!/usr/bin/env bash
# First boot only (empty data dir). Later runs of the same bootstrap come from scripts/up.sh.
set -euo pipefail
bash /db/bootstrap/bootstrap.sh
