#!/bin/sh
# cron 容器入口：写入 crontab 后前台运行 busybox crond。
# busybox crond 的子任务会继承容器环境变量（含 INTERNAL_CRON_TOKEN）。
set -eu
: "${INTERNAL_CRON_TOKEN:?INTERNAL_CRON_TOKEN is required}"

cat > /etc/crontabs/root <<'EOF'
# 每 5 分钟兜底驱动一轮学习任务队列（正常情况下 after() 已经跑过）
*/5 * * * * /bin/sh /usr/local/bin/cron-call.sh /api/internal/learning/run-jobs
# 每天 03:30 触发每日学习计划
30 3 * * * /bin/sh /usr/local/bin/cron-call.sh /api/internal/learning/daily
EOF

exec crond -f -l 8
