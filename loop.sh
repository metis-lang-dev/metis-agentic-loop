#!/usr/bin/env bash
# tools/pi/loop.sh — the agentic loop (docs/LOOP-AGENT.md): pi with the two
# metis extensions over a catalog, on Ollama's Gemma 4 E4B.
#
#   tools/pi/loop.sh --scratch DIR [pi args...]   a scratch catalog in DIR (made once: the
#                                                 catalog's tools + the example's world), the trial
#   METIS_CATALOG=… tools/pi/loop.sh [pi args...] an existing catalog (the person's)
#
#   MODEL=ollama/metis-gemma4-e4b (default; …-cpu: no layer on the GPU)
#   OLLAMA_URL=http://127.0.0.1:11434 (default; another Ollama server, e.g. a user-level one
#              when the system service started before the GPU driver and serves CPU only)
#   pi args: e.g. --mode rpc (a client is the person), or none (pi's TUI)
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
AGENT="$(cd "$HERE/../.." && pwd)"                 # metis-agent
PKGS="$(cd "$AGENT/.." && pwd)"                     # the sibling checkouts
if [ "${1:-}" = --scratch ]; then
  S="$(mkdir -p "$2" && cd "$2" && pwd)"; shift 2
  if [ ! -d "$S/catalog/domains" ]; then
    mkdir -p "$S/catalog/domains"
    cp -r "$PKGS/metis-catalog/tools" "$PKGS/metis-catalog/metis_catalog" "$S/catalog/"
    cp -r "$PKGS/metis-catalog/domains/plant" "$S/catalog/domains/"       # a known domain beside the new one
    rm -rf "$S/catalog/domains/plant/records" "$S/catalog/domains/plant/build"
    mkdir -p "$S/catalog/domains/lamp"
    cp "$HERE/example/lamp/lamp_host.py" "$S/catalog/domains/lamp/"     # the world, before any program
  fi
  export METIS_CATALOG="$S/catalog" METIS_LOOP_RECORDS="$S/records" PI_LOOP_SESSIONS="$S/sessions"
  # the REPL starts beside a known domain: formalize shows the model the served
  # world's vocabulary (a blank world shows it none, and E4B then writes no LLP)
  export METIS_LOOP_LLP="${METIS_LOOP_LLP-$S/catalog/domains/plant/plant.llp}"
  mkdir -p "$S/records" "$S/sessions" "$S/work"; cd "$S/work"
fi
: "${METIS_CATALOG:?set METIS_CATALOG or use --scratch DIR}"
MODEL="${MODEL:-ollama/metis-gemma4-e4b}"
OLLAMA_URL="${OLLAMA_URL:-http://127.0.0.1:11434}"
if [ "$OLLAMA_URL" != http://127.0.0.1:11434 ]; then       # pi's provider at that server, for this run
  AD="$(mktemp -d -t metis-loop-agent-XXXX)"
  sed "s#http://127.0.0.1:11434#$OLLAMA_URL#" "$HERE/agent/models.json" > "$AD/models.json"
  export PI_CODING_AGENT_DIR="$AD"
fi
# the kernel's formalize on the same model, thinking off (ollama/generate.py, the
# kernel's command: backend; its own ollama backend lets Gemma 4 think for minutes)
CONF="${METIS_CONFIG:-$(mktemp -t metis-loop-XXXX.toml)}"
[ -s "$CONF" ] || printf '[llm]\nendpoint = "command:python3 %s/ollama/generate.py --model %s --url %s"\n' \
  "$HERE" "${MODEL#ollama/}" "$OLLAMA_URL" > "$CONF"
export METIS_CONFIG="$CONF"
export METIS_LOOP_METIS="${METIS_LOOP_METIS:-$PKGS/.venv/bin/metis}"
export METIS_LOOP_PYTHON="${METIS_LOOP_PYTHON:-$AGENT/py/.venv/bin/python}"
export METIS_LOOP_AGENT_PY="${METIS_LOOP_AGENT_PY:-$AGENT/py/.venv/bin/python}"
export METIS_LOOP_AGENT_DIR="$AGENT/py"
case "$MODEL" in *-cpu) export METIS_LOOP_CUDA="" ;; esac   # the domain agent too
exec "$HERE/pi.sh" --model "$MODEL" --system-prompt "$HERE/prompts/loop-system.md" "$@"
