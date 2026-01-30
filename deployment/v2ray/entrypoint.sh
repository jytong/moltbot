#!/bin/sh

PYTHON_VERSION=$(python3 -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')

LANGGRAPH_SERVER_HOST=${LANGGRAPH_SERVER_HOST:-0.0.0.0}

# Allow for an optional override of `PORT`, which is reserved in some environments.
if [ -n "$LANGGRAPH_SERVER_PORT" ]; then
    export PORT=$LANGGRAPH_SERVER_PORT
fi

# 启动 v2ray
echo "Starting v2ray..."
/usr/local/bin/v2ray run -config /usr/local/etc/v2ray/config.json &
V2RAY_PID=$!
echo "v2ray started with PID: $V2RAY_PID"

# 给 v2ray 一些启动时间
sleep 2

RELOAD=""
if [ -n "$LANGSMITH_LANGGRAPH_DESKTOP" ]; then
    echo "LANGSMITH_LANGGRAPH_DESKTOP is set. Running uvicorn with --reload flag..."
    RELOAD="--reload"
fi

# Optionally start the Go Core API gRPC server if the feature flag is set
if [ "${FF_USE_CORE_API}" = "true" ] && command -v core-api-grpc >/dev/null 2>&1; then
    echo "FF_USE_CORE_API=true — starting Go Core API gRPC server on :50051"
    # Inherit env: DATABASE_URI / POSTGRES_URI, LANGSERVE_GRAPHS, etc.
    core-api-grpc &
fi

if [ -n "$DD_API_KEY" ] && { [ "$PYTHON_VERSION" = "3.11" ] || [ "$PYTHON_VERSION" = "3.12" ]; }; then
    echo "WARNING: DD_API_KEY is set. Datadog tracing will wrap the entire server process."
    echo "         Only use this if you want Datadog as your primary tracing provider."
    echo "         Do NOT set DD_API_KEY if you want to use OpenTelemetry or another tracing backend."
    exec /app/datadog-init /dd_tracer/python/bin/ddtrace-run uvicorn langgraph_api.server:app --log-config /api/logging.json --host $LANGGRAPH_SERVER_HOST --port $PORT --no-access-log --timeout-graceful-shutdown 3600 $RELOAD
else
    exec uvicorn langgraph_api.server:app --log-config /api/logging.json --host $LANGGRAPH_SERVER_HOST --port $PORT --no-access-log --timeout-graceful-shutdown 3600 $RELOAD
fi
