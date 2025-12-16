#!/bin/bash
# PreToolUse hook for Nocur permission handling (Claude Code).
# Communicates with the Nocur app via a Unix socket to get user approval.

set -euo pipefail

SOCKET_DIR="${TMPDIR:-/tmp}"
SOCKET_PATH="${SOCKET_DIR%/}/nocur-permissions.sock"
TIMEOUT=60 # seconds to wait for user response

# Read the tool info from stdin
TOOL_INFO="$(cat)"

# If permission mode is bypassPermissions, auto-approve without prompting.
if echo "$TOOL_INFO" | grep -q '"permission_mode":"bypassPermissions"'; then
  echo '{"decision":"approve","reason":"Bypass mode enabled"}'
  exit 0
fi

# Require Nocur to be running for approvals (secure-by-default).
if [ ! -S "$SOCKET_PATH" ]; then
  echo '{"decision":"block","reason":"Nocur permission socket not found. Start Nocur or disable this hook."}'
  exit 0
fi

if ! command -v nc >/dev/null 2>&1; then
  echo '{"decision":"block","reason":"netcat (nc) not found. Install it or disable this hook."}'
  exit 0
fi

# Send request to Nocur and wait for response (nc supports Unix sockets on macOS).
RESPONSE="$(echo "$TOOL_INFO" | nc -U -w "$TIMEOUT" "$SOCKET_PATH" 2>/dev/null || true)"

if [ -z "$RESPONSE" ]; then
  echo '{"decision":"block","reason":"Permission request timed out"}'
  exit 0
fi

echo "$RESPONSE"
