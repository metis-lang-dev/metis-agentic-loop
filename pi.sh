#!/usr/bin/env bash
# pi.sh — pi as the agentic loop's host: the pinned node and pi, this
# directory's agent config (models.json: Ollama, and pi's built-in OpenRouter capped at
# 2048 output tokens with data_collection=deny; a key only from the environment,
# never in a file here; no OAuth), no startup network, no built-in tools, no
# context files, skills, prompt templates or MCP, only the two metis extensions
# (docs/LOOP-AGENT.md). The TUI in regular mode: the apply gate's diff can be taller
# than the terminal, and fullscreen then hides its Yes/No; regular leaves it in the
# terminal's scrollback (a later --tui-mode fullscreen overrides).
#   pi.sh [pi args...]      e.g. --mode rpc, --model ollama/metis-gemma4-e4b
HERE="$(cd "$(dirname "$0")" && pwd)"
export PATH="$HERE/node/bin:$PATH" PI_CODING_AGENT_DIR="${PI_CODING_AGENT_DIR:-$HERE/agent}" \
       PI_OFFLINE=1 PI_SKIP_VERSION_CHECK=1 PI_TELEMETRY=0
"$HERE/setup.sh" --link                              # extensions/sdk: the loop SDK's TypeScript face, as installed
exec "$HERE/node_modules/.bin/pi" --no-builtin-tools --no-context-files --no-skills \
  --no-prompt-templates --no-mcp --no-approve --no-extensions --tui-mode regular \
  -e "$HERE/extensions/metis-repl.ts" -e "$HERE/extensions/metis-domain.ts" \
  --session-dir "${PI_LOOP_SESSIONS:-$HERE/agent/sessions}" "$@"
