#!/usr/bin/env bash
# demo.sh — the worked example as a demo (agentic-loop s-3ddb3e87 step 2): pi's TUI on a
# fresh scratch catalog, you are the person; pi drives and the kernel's formalize drafts on
# DeepSeek V4 Pro through OpenRouter (reasoning off, 2048 output tokens, data_collection deny).
#
#   OPENROUTER_API_KEY=… ./demo.sh [DIR]       DIR: default ~/lamp-demo-<date>-<time>
#   MODEL=openrouter/<id>:off ./demo.sh        another OpenRouter model (formalize follows it)
#
# It prints the key's spend before and after (never the key), and the prompt to paste
# (also in DIR/prompt.md): the goal and the lamp's prose, as example/person.py gives them.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
PKGS="$(cd "$HERE/.." && pwd)"
: "${OPENROUTER_API_KEY:?the OpenRouter key from the environment: export OPENROUTER_API_KEY=… (or set -a; . FILE; set +a)}"
export MODEL="${MODEL:-openrouter/deepseek/deepseek-v4-pro:off}"
DIR="${1:-$HOME/lamp-demo-$(date +%Y%m%d-%H%M)}"
[ ! -e "$DIR/catalog" ] || { echo "demo.sh: $DIR has a catalog already: name a new directory" >&2; exit 1; }
mkdir -p "$DIR"
SDK_PY="${METIS_LOOP_SDK_PY:-$PKGS/.venv/bin/python}"
usage() { "$SDK_PY" "$HERE/example/openrouter_key.py" | "$SDK_PY" -c 'import json,sys; print(json.load(sys.stdin)["usage"])'; }
before="$(usage)"
"$SDK_PY" -c 'import sys; sys.path.insert(0, sys.argv[1] + "/example"); import person
print(person.GOAL + open(sys.argv[1] + "/example/lamp/prose.md").read(), end="")' "$HERE" > "$DIR/prompt.md"
cat <<EOF
The agentic loop's demo: $MODEL drives pi, and formalizes.
The key has spent $before USD so far. A run costs about 0.01–0.04 USD and takes 2–5 minutes
(three measured runs: README, "The demo").

Paste this as your first message (it is also in $DIR/prompt.md):
----------------------------------------------------------------------
$(cat "$DIR/prompt.md")
----------------------------------------------------------------------
Steer by typing while the model works (pi sends it as a steer); every write to the
catalog stops at a "Apply to the catalog …?" box with the diff: you approve or refuse it.
Leave pi with ctrl+c twice (or /quit).

EOF
read -r -p "Press Enter to start pi. " _
st=0; "$HERE/loop.sh" --scratch "$DIR" || st=$?
after="$(usage)"
"$SDK_PY" -c 'import sys; b, a = map(float, sys.argv[1:3]); print("This run: %.4f USD by the key'"'"'s usage (OpenRouter may add the last calls a minute later)." % (a - b))' "$before" "$after"
echo "The run's files: $DIR (the catalog it wrote, the pi session, records/formalize-calls.jsonl)."
exit "$st"
