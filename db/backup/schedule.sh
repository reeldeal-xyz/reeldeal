#!/bin/sh
# Run backup.sh every day at $BACKUP_AT (local time, TZ=Asia/Tokyo; Japan has no DST).
set -eu
at="${BACKUP_AT:-02:00}"
echo "backup: scheduled daily at $at $TZ"
while true; do
  now=$(date +%s)
  next=$(date -d "$(date +%Y-%m-%d) $at" +%s)
  [ "$next" -le "$now" ] && next=$((next + 86400))
  sleep $((next - now))
  backup.sh || echo "backup: FAILED at $(date -Iseconds)" >&2
done
