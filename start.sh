#!/bin/bash
set -euo pipefail

# Simple SRS: start the backend (API, :3000) and frontend (Vite, :5173) together.
# Ctrl+C (SIGINT / SIGTERM) stops both servers cleanly.

BACKEND_PORT="${BACKEND_PORT:-3000}"
FRONTEND_PORT="${FRONTEND_PORT:-5173}"
BACKEND_LOG="/tmp/simple-srs-backend.log"
FRONTEND_LOG="/tmp/simple-srs-frontend.log"

# The spawned processes read these to bind the right ports.
export BACKEND_PORT
export FRONTEND_PORT


check_dependencies() {
  local bin
  for bin in node npm; do
    if [ "$(command -v "$bin")" = "" ]; then
      echo "ERROR: \"$bin\" is not installed. Aborting."
      exit 1
    fi
  done

  local dir
  for dir in backend frontend; do
    if [ ! -d "$dir/node_modules" ]; then
      echo "ERROR: $dir/node_modules not found. Install dependencies first:"
      echo "  cd $dir && npm ci"
      exit 1
    fi
  done
}


port_open() {
  local port="$1"
  local host="127.0.0.1"

  # Try to connect to host:port in a subshell. bash's /dev/tcp virtual filesystem
  # opens a socket, which only succeeds if something is listening on the port.
  # 2> /dev/null hides the "connection refused" error when the port is free.
  # The subshell closes the descriptor when it exits, so nothing leaks.
  if (exec 3<>"/dev/tcp/$host/$port") 2> /dev/null; then
    # The port is open / in use
    return 0
  fi

  # The port is free
  return 1
}


check_port() {
  local port="$1"
  local name="$2"

  if port_open "$port"; then
    echo "ERROR: Port $port ($name) is already in use. Stop that process and retry."
    exit 1
  fi
}


start_backend() {
  echo "Starting backend (API)  on :$BACKEND_PORT ..."
  npm --prefix backend run dev > "$BACKEND_LOG" 2>&1 &
  BACKEND_PID=$!
}


start_frontend() {
  echo "Starting frontend (UI)  on :$FRONTEND_PORT ..."
  npm --prefix frontend run dev > "$FRONTEND_LOG" 2>&1 &
  FRONTEND_PID=$!
}


print_launch_info() {
  cat <<EOF

Simple SRS is running:
  Backend  API : http://localhost:$BACKEND_PORT
  Frontend UI : http://localhost:$FRONTEND_PORT
  Logs        : $BACKEND_LOG  |  $FRONTEND_LOG

Press Ctrl+C to stop both.

EOF
}


# Kill a process AND all of its children (npm -> shell -> node / vite -watcher).
kill_tree() {
  local pid="$1"
  if [ -z "$pid" ]; then
    return 0
  fi
  if ! kill -0 "$pid" 2> /dev/null; then
    return 0
  fi

  local children
  children="$(pgrep -P "$pid" 2> /dev/null || true)"
  for child in $children; do
    kill_tree "$child"
  done

  kill -TERM "$pid" 2> /dev/null || true
  sleep 0.3
  kill -KILL "$pid" 2> /dev/null || true
}


cleanup() {
  echo
  echo "Stopping Simple SRS..."
  kill_tree "$BACKEND_PID"
  kill_tree "$FRONTEND_PID"
  wait "$BACKEND_PID" "$FRONTEND_PID" 2> /dev/null || true
  echo "Stopped."
  exit 0
}


main() {
  check_dependencies
  check_port "$BACKEND_PORT" "backend"
  check_port "$FRONTEND_PORT" "frontend"
  start_backend
  start_frontend
  print_launch_info

  # Wait for the first server to finish; then stop the other one.
  wait -n "$BACKEND_PID" "$FRONTEND_PID" || true
  cleanup
}


trap cleanup INT TERM

main
