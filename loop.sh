#!/usr/bin/env bash
# loop.sh — the agentic loop (docs/LOOP-AGENT.md): pi with the two
# metis extensions over a catalog, on Ollama's Gemma 4 E4B.
#
# A loop starts in a directory, and that directory is the catalog and the workspace
# (cwd-root s-ddac2cbf), as `cd DIR && claude` makes DIR the project: DIR's domain
# packages are the catalog (an empty DIR is an empty catalog: the first catalog_apply
# writes DIR/domains/<name>/), pi runs in DIR, and the loop's own state goes in
# DIR/.metis/ (the loop SDK's catalog.state(): records/, sessions/, seed/, seed.json;
# git-ignored when DIR is a checkout).
#
#   cd DIR && loop.sh [pi args...]       the loop over DIR
#   cd DIR && loop.sh --seed PATH.llp|PKG_DIR [--name NAME] [--episodes N] [pi args...]
#                                        a seeded start: the REPL serves an existing program
#                                        (a copy in DIR/.metis/seed/), and pi's first message asks
#                                        the model to make it DIR's domain NAME (default: the file's
#                                        stem, - as _) through catalog_apply what=served — its rules
#                                        unchanged — then exercise it and, when the person asks,
#                                        catalog_take it (prompts/seed-task.md). A DIR is seeded once:
#                                        the same --seed again goes on with it.
#                                        --episodes N: the n of the task's domain_episodes (an RDDL
#                                        world's measure; default 20), in the task from its first
#                                        message, so the model never runs another n before the person's
#                                        PKG_DIR, a domain package (its manifest, program, included
#                                        files, host): copied whole into DIR/.metis/seed/domains/NAME/,
#                                        its program served there; what=served takes the package into
#                                        DIR, every file at the gate
#   --into DIR2 (or METIS_LOOP_TAKE_INTO=DIR2)
#                                        the catalog catalog_take takes a finished domain into (gated,
#                                        never a commit); none named: catalog_take refuses
#   METIS_CATALOG=DIR loop.sh …          the same, started elsewhere
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
#   METIS_LOOP_LLP=<file.llp>  the program the REPL starts on (default: a blank world; demo.sh
#              starts on the plant, so formalize sees a known world's vocabulary)
#   pi args: e.g. --mode rpc (a client is the person), or none (pi's TUI)
#   METIS_LOOP_PI=<cmd>  run it in pi.sh's place, with pi.sh's arguments (the tests' stand-in)
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
PKGS="$(cd "$HERE/.." && pwd)"                      # the workspace: its .venv, metis-agent (defaults only)
AGENT="${METIS_AGENT:-$PKGS/metis-agent}"           # the domain agent's checkout
for a in "$@"; do
  [ "$a" != --scratch ] || { echo "loop.sh: --scratch is gone: cd DIR && loop.sh (DIR is the catalog; cwd-root s-ddac2cbf)" >&2; exit 2; }
done
# the loop SDK's python (metis_loop_sdk: the catalog's root and state, the model adapters)
SDK_PY="${METIS_LOOP_SDK_PY:-$PKGS/.venv/bin/python}"
"$SDK_PY" -c "import metis_loop_sdk.models, metis_loop_sdk.catalog" 2>/dev/null || {
  echo "no loop SDK in $SDK_PY: pip install metis-loop-sdk (its sdk-vX.Y.Z tag), or set METIS_LOOP_SDK_PY" >&2; exit 1; }
sdk() { "$SDK_PY" -m metis_loop_sdk.catalog --root "$DIR" "$@" --json; }
field() { "$SDK_PY" -c 'import json,sys; o=json.load(sys.stdin); print(o.get(sys.argv[1]) or "", end="")' "$1"; }
TASK=()
SEED="" NAME="" EPISODES="" INTO="${METIS_LOOP_TAKE_INTO:-}"
while [ $# -gt 0 ]; do
  case "$1" in
    --seed) SEED="$(cd "$(dirname "$2")" && pwd)/$(basename "$2")"; shift 2 ;;
    --name) NAME="$2"; shift 2 ;;
    --episodes) EPISODES="$2"; shift 2 ;;
    --into) INTO="$2"; shift 2 ;;
    *) break ;;
  esac
done
DIR="${METIS_CATALOG:-$PWD}"
[ -d "$DIR" ] || { echo "loop.sh: no directory $DIR (METIS_CATALOG)" >&2; exit 1; }
DIR="$(cd "$DIR" && pwd)"
if [ -n "$INTO" ]; then
  [ -d "$INTO" ] || { echo "loop.sh: --into $INTO: no such directory (the catalog catalog_take takes a domain into)" >&2; exit 1; }
  INTO="$(cd "$INTO" && pwd)"
  [ "$INTO" != "$DIR" ] || { echo "loop.sh: --into $INTO is the catalog the loop runs in" >&2; exit 1; }
fi
if [ -n "$EPISODES" ] && ! { [[ "$EPISODES" =~ ^[1-9][0-9]*$ ]] && [ "$EPISODES" -le 50 ]; }; then
  echo "loop.sh: --episodes $EPISODES: 1-50 (domain_episodes' n)" >&2; exit 1
fi
if [ -z "$SEED" ] && { [ -n "$NAME" ] || [ -n "$EPISODES" ]; }; then
  echo "loop.sh: --name and --episodes go with --seed" >&2; exit 1
fi
PACKAGE=""
if [ -n "$SEED" ]; then
  if [ -d "$SEED" ]; then                                             # a domain package, as it is
    [ -f "$SEED/domain.yaml" ] || { echo "loop.sh: --seed $SEED: a directory seed is a domain package (its domain.yaml)" >&2; exit 1; }
    PACKAGE=1; base="$(basename "$SEED")"
  else
    [ -f "$SEED" ] || { echo "loop.sh: --seed $SEED: no such file" >&2; exit 1; }
    base="$(basename "$SEED" .llp)"
  fi
  NAME="${NAME:-${base//-/_}}"
  [[ "$NAME" =~ ^[a-z][a-z0-9_]*$ ]] || { echo "loop.sh: the domain name '$NAME': lowercase letters, digits, _ (give --name NAME)" >&2; exit 1; }
  case "$SEED" in */domains/*) REL="domains/${SEED#*/domains/}" ;; *) REL="$SEED" ;; esac   # catalog-relative inside a catalog
  WANT="{\"seed\": \"$REL\", \"name\": \"$NAME\"${PACKAGE:+, \"package\": true}}"
fi
ST="$(sdk state | field state)"                    # DIR/.metis/: made, and git-ignored in a checkout
if [ -n "$SEED" ]; then
  if [ -f "$ST/seed.json" ]; then
    [ "$(cat "$ST/seed.json")" = "$WANT" ] || { echo "loop.sh: $DIR was seeded otherwise ($(cat "$ST/seed.json")): seed a new DIR" >&2; exit 1; }
  else
    if sdk get "$NAME" > /dev/null 2>&1; then
      echo "loop.sh: $DIR has a domain $NAME already: --name another, or start without --seed" >&2; exit 1
    fi
    if [ -n "$PACKAGE" ]; then                                        # the package, a catalog of its own outside DIR's
      mkdir -p "$ST/seed/domains/$NAME"
      (cd "$SEED" && tar --exclude=./build --exclude=./records --exclude=__pycache__ -cf - .) | (cd "$ST/seed/domains/$NAME" && tar -xf -)
    else                                                              # the seed, served from a copy outside the catalog
      mkdir -p "$ST/seed" && cp "$SEED" "$ST/seed/$NAME.llp"
    fi
    printf '%s' "$WANT" > "$ST/seed.json"
  fi
  if [ -n "$PACKAGE" ]; then                                          # its program where it is, so its includes resolve
    METIS_LOOP_LLP="$("$SDK_PY" -m metis_loop_sdk.catalog --root "$ST/seed" get "$NAME" --json | field program)" || true
    [ -n "$METIS_LOOP_LLP" ] || { echo "loop.sh: --seed $SEED: its domain.yaml names no program the loop SDK reads" >&2; exit 1; }
    export METIS_LOOP_LLP
  else
    export METIS_LOOP_LLP="$ST/seed/$NAME.llp"
  fi
  # pi's first message: the seeded task (a client over --mode rpc sends it itself: DIR/.metis/seed/task.md)
  t="$(cat "$HERE/prompts/seed-task.md")"; t="${t//"{{SEED}}"/"$REL"}"; t="${t//"{{NAME}}"/"$NAME"}"   # no sed: any path
  t="${t//"{{EPISODES}}"/"${EPISODES:-20}"}"
  printf '%s\n' "$t" > "$ST/seed/task.md"
  case " $* " in *" --mode "*) ;; *) TASK=("$(cat "$ST/seed/task.md")") ;; esac
fi
export METIS_CATALOG="$DIR" METIS_LOOP_RECORDS="$ST/records" PI_LOOP_SESSIONS="$ST/sessions" METIS_LOOP_RUN="$ST"
# catalog_take's target: only the one named (--into, METIS_LOOP_TAKE_INTO), never a default
export METIS_LOOP_TAKE_INTO="$INTO"
# an RDDL world's host imports tools/rddl_host.py, which it looks for above its own directory;
# a DIR without tools/ (any DIR, a seed under .metis/) gets the installed metis-catalog's
TOOLS="$("$SDK_PY" -m metis_loop_sdk.catalog installed --json | field tools)"
export PYTHONPATH="$TOOLS${PYTHONPATH:+:$PYTHONPATH}"
mkdir -p "$ST/records" "$ST/sessions"
cd "$DIR"                                           # the workspace: pi and the tools it runs, in DIR
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
# an RDDL world's host runs its gym under this python (tools/rddl_host.py: pyRDDLGym); a DIR
# has no .venv beside it and the domain agent's venv has no gym (rddl-worlds step 2, finding 1)
export METIS_RDDL_PY="${METIS_RDDL_PY:-$PKGS/.venv/bin/python}"
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
exec "${METIS_LOOP_PI:-$HERE/pi.sh}" --model "$MODEL" --system-prompt "$HERE/prompts/loop-system.md" "$@" "${TASK[@]}"
