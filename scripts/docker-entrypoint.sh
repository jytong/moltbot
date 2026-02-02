#!/usr/bin/env bash
set -euo pipefail

# Moltbot Docker Entrypoint Script
# Add any pre-start initialization or additional services here

# ============================================
# Environment Setup
# ============================================
export NODE_ENV="${NODE_ENV:-production}"

# ============================================
# Pre-start hooks (add your custom logic here)
# ============================================

# 启动 v2ray
echo "Starting v2ray..."
/usr/local/bin/v2ray run -config /usr/local/etc/v2ray/config.json &
V2RAY_PID=$!
echo "v2ray started with PID: $V2RAY_PID"

# 给 v2ray 一些启动时间
sleep 2

# Example: Wait for external services
# if [ -n "${WAIT_FOR_HOST:-}" ]; then
#   echo "Waiting for ${WAIT_FOR_HOST}..."
#   while ! nc -z "${WAIT_FOR_HOST}" "${WAIT_FOR_PORT:-80}"; do
#     sleep 1
#   done
# fi

# Example: Run database migrations
# if [ "${RUN_MIGRATIONS:-0}" = "1" ]; then
#   echo "Running migrations..."
#   node dist/migrate.js
# fi

# ============================================
# Start additional services (if needed)
# ============================================

# Example: Start a background health check service
# start_health_monitor() {
#   while true; do
#     sleep 60
#     # your health check logic
#   done
# }
# start_health_monitor &

# ============================================
# Main application startup
# ============================================
echo "Starting moltbot..."

# Default command: run gateway
# Override by passing arguments to docker run
if [ $# -eq 0 ]; then
  exec node dist/index.js gateway --bind lan --port 18789 --allow-unconfigured
else
  exec node dist/index.js "$@"
fi
