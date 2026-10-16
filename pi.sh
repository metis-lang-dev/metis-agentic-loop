#!/usr/bin/env bash
# tools/pi/pi.sh — pi as the agentic loop's host: the pinned node and pi, this
# directory's agent config (models.json: Ollama only; no keys, no OAuth), no
# network beyond Ollama, no built-in tools, no context files, skills, prompt
# templates or MCP, only the two metis extensions (docs/LOOP-AGENT.md).
#   tools/pi/pi.sh [pi args...]      e.g. --mode rpc, --model ollama/metis-gemma4-e4b
HERE="$(cd "$(dirname "$0")" && pwd)"
export PATH="$HERE/node/bin:$PATH" PI_CODING_AGENT_DIR="$HERE/agent" \
       PI_OFFLINE=1 PI_SKIP_VERSION_CHECK=1 PI_TELEMETRY=0
exec "$HERE/node_modules/.bin/pi" --no-builtin-tools --no-context-files --no-skills \
  --no-prompt-templates --no-mcp --no-approve --no-extensions \
  -e "$HERE/extensions/metis-repl.ts" -e "$HERE/extensions/metis-domain.ts" \
  --session-dir "${PI_LOOP_SESSIONS:-$HERE/agent/sessions}" "$@"
