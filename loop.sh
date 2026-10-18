#!/usr/bin/env bash
# loop.sh — the agentic loop (docs/LOOP-AGENT.md): pi with the two
# metis extensions over a catalog, on Ollama's Gemma 4 E4B.
#
#   loop.sh --scratch DIR [pi args...]   a scratch catalog in DIR (made once: the
#                                                 catalog's tools + the example's world), the trial
#   METIS_CATALOG=… loop.sh [pi args...] an existing catalog (the person's)
#
#   MODEL=ollama/metis-gemma4-e4b (default; …-cpu: no layer on the GPU), or another pi
#         provider's model, e.g. openrouter/qwen/qwen3-235b-a22b-2507 (its key from the
#         environment only: OPENROUTER_API_KEY; agent/models.json caps and routes it)
#   FORMALIZE_MODEL=the model the kernel's formalize drafts with: an Ollama model (NAME or
#         ollama/NAME), or openrouter/<id> (the loop SDK's OpenAI-compatible command face,
#         reasoning off, 2048 tokens, data_collection deny; its calls and their cost in
#         $METIS_LOOP_RECORDS/formalize-calls.jsonl). Default: MODEL's, thinking suffix
#         dropped (formalize where the driver is); metis-gemma4-e4b for any other provider
#   OLLAMA_URL=http://127.0.0.1:11434 (default; another Ollama server, e.g. a user-level one
#              when the system service started before the GPU driver and serves CPU only)
#   pi args: e.g. --mode rpc (a client is the person), or none (pi's TUI)
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
PKGS="$(cd "$HERE/.." && pwd)"                      # the sibling checkouts
AGENT="${METIS_AGENT:-$PKGS/metis-agent}"           # the domain agent's checkout
if [ "${1:-}" = --scratch ]; then
  S="$(mkdir -p "$2" && cd "$2" && pwd)"; shift 2
  if [ ! -d "$S/catalog/domains" ]; then
    mkdir -p "$S/catalog/domains"
    cp -r "$PKGS/metis-catalog/tools" "$S/catalog/"                     # the intent generator the SDK runs on it
    cp -r "$PKGS/metis-catalog/domains/plant" "$S/catalog/domains/"       # a known domain beside the new one
    rm -rf "$S/catalog/domains/plant/records" "$S/catalog/domains/plant/build"
    mkdir -p "$S/catalog/domains/lamp"
    cp "$HERE/example/lamp/lamp_host.py" "$S/catalog/domains/lamp/"     # the world, before any program
  fi
  export METIS_CATALOG="$S/catalog" METIS_LOOP_RECORDS="$S/records" PI_LOOP_SESSIONS="$S/sessions"
  # catalog_take's target: the person's catalog a finished domain is taken into (gated, never a commit)
  export METIS_LOOP_TAKE_INTO="${METIS_LOOP_TAKE_INTO-$PKGS/metis-catalog}"
  # the REPL starts beside a known domain: formalize shows the model the served
  # world's vocabulary (a blank world shows it none, and E4B then writes no LLP)
  export METIS_LOOP_LLP="${METIS_LOOP_LLP-$S/catalog/domains/plant/plant.llp}"
  mkdir -p "$S/records" "$S/sessions" "$S/work"; cd "$S/work"
fi
: "${METIS_CATALOG:?set METIS_CATALOG or use --scratch DIR}"
MODEL="${MODEL:-ollama/metis-gemma4-e4b}"
case "$MODEL" in
  ollama/*|openrouter/*) FORMALIZE_MODEL="${FORMALIZE_MODEL:-$MODEL}" ;;
  *)                     FORMALIZE_MODEL="${FORMALIZE_MODEL:-metis-gemma4-e4b}" ;;
esac
FORMALIZE_MODEL="${FORMALIZE_MODEL#ollama/}"
case "$FORMALIZE_MODEL" in                                       # pi's thinking suffix is pi's, not the model's
  *:off|*:minimal|*:low|*:medium|*:high|*:xhigh|*:max) FORMALIZE_MODEL="${FORMALIZE_MODEL%:*}" ;;
esac
OLLAMA_URL="${OLLAMA_URL:-http://127.0.0.1:11434}"
if [ "$OLLAMA_URL" != http://127.0.0.1:11434 ]; then       # pi's provider at that server, for this run
  AD="$(mktemp -d -t metis-loop-agent-XXXX)"
  sed "s#http://127.0.0.1:11434#$OLLAMA_URL#" "$HERE/agent/models.json" > "$AD/models.json"
  export PI_CODING_AGENT_DIR="$AD"
fi
# the loop SDK's python (metis_loop_sdk: the model adapters)
SDK_PY="${METIS_LOOP_SDK_PY:-$PKGS/.venv/bin/python}"
"$SDK_PY" -c "import metis_loop_sdk.models" 2>/dev/null || {
  echo "no loop SDK in $SDK_PY: $SDK_PY -m pip install -e $PKGS/metis-loop/sdk (or set METIS_LOOP_SDK_PY)" >&2; exit 1; }
# the server serves the model on the GPU? (the SDK's probe; a system service started
# before the GPU driver serves CPU only, silently). It loads the model, as the run would.
case "$FORMALIZE_MODEL" in
  *-cpu|openrouter/*) ;;
  *) "$SDK_PY" -m metis_loop_sdk.models ollama-probe --url "$OLLAMA_URL" --model "$FORMALIZE_MODEL" --load \
              > "${TMPDIR:-/tmp}/metis-loop-probe.json" || {
              echo "loop.sh: $(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["why"])' \
                "${TMPDIR:-/tmp}/metis-loop-probe.json")" >&2; } ;;
esac
# the kernel's formalize on FORMALIZE_MODEL, thinking off: the SDK's ollama command
# face (the kernel's own ollama backend lets Gemma 4 think for minutes), or its
# OpenAI-compatible one on OpenRouter (the key reaches it through the environment:
# pi's, then the REPL's), through the kernel's command: backend
CONF="${METIS_CONFIG:-$(mktemp -t metis-loop-XXXX.toml)}"
if grep -q "ollama/generate.py" "$CONF" 2>/dev/null; then          # an old config: that adapter is the SDK's now
  echo "loop.sh: $CONF names ollama/generate.py, which is gone: unset METIS_CONFIG (loop.sh writes one) or use" \
       "command:$SDK_PY -m metis_loop_sdk.models ollama-command --model M" >&2; exit 1
fi
if [ ! -s "$CONF" ]; then
  case "$FORMALIZE_MODEL" in
    openrouter/*)
      : "${OPENROUTER_API_KEY:?formalize on $FORMALIZE_MODEL: OPENROUTER_API_KEY from the environment}"
      FACE="openai-command --base-url https://openrouter.ai/api/v1 --model ${FORMALIZE_MODEL#openrouter/}"
      FACE="$FACE${METIS_LOOP_RECORDS:+ --log $METIS_LOOP_RECORDS/formalize-calls.jsonl}" ;;
    *) FACE="ollama-command --model $FORMALIZE_MODEL --url $OLLAMA_URL" ;;
  esac
  printf '[llm]\nendpoint = "command:%s -m metis_loop_sdk.models %s"\n' "$SDK_PY" "$FACE" > "$CONF"
fi
export METIS_CONFIG="$CONF"
export METIS_LOOP_METIS="${METIS_LOOP_METIS:-$PKGS/.venv/bin/metis}"
export METIS_LOOP_SDK_PY="$SDK_PY"                    # the extensions' catalog: the loop SDK's catalog CLI
export METIS_LOOP_AGENT_PY="${METIS_LOOP_AGENT_PY:-$AGENT/py/.venv/bin/python}"
export METIS_LOOP_AGENT_DIR="$AGENT/py"
case "$FORMALIZE_MODEL" in *-cpu) export METIS_LOOP_CUDA="" ;; esac   # the domain agent too
exec "$HERE/pi.sh" --model "$MODEL" --system-prompt "$HERE/prompts/loop-system.md" "$@"
