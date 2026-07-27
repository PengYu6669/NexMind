#!/bin/sh
# 用 busybox wget 向 app 的 internal 接口发 POST（带 cron 鉴权头）。
set -eu
path="$1"
wget -q -O - \
  --header "Authorization: Bearer ${INTERNAL_CRON_TOKEN}" \
  --header "Content-Type: application/json" \
  --post-data '{}' \
  "http://app:3000${path}" || echo "cron call ${path} failed"
