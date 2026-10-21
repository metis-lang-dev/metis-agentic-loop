#!/usr/bin/env bash
# demo.sh — the worked example as a demo (agentic-loop s-3ddb3e87 step 2): pi's TUI on a
# fresh catalog, you are the person; pi drives and the kernel's formalize drafts on
# DeepSeek V4 Pro through OpenRouter (reasoning off, 2048 output tokens, data_collection deny).
# The principle in a few lines (cwd-root s-ddac2cbf): mkdir DIR && cd DIR, lay out the lamp's
# world there (a known domain beside it, the plant from the installed metis-catalog, and the
# lamp's host before any program: the lamp is prose and a host, not a package to --seed),
# then loop.sh in DIR. The lamp is written into DIR/domains/lamp/; take.sh takes it elsewhere.
#
#   OPENROUTER_API_KEY=… ./demo.sh [DIR]       DIR: default ~/lamp-demo-<date>-<time>
#   METIS_LOOP_TAKE_INTO=DIR2 ./demo.sh        catalog_take in the session takes the lamp into DIR2
#   MODEL=openrouter/<id>:off ./demo.sh        another OpenRouter model (formalize follows it)
#
# It prints the key's spend before and after (never the key), and the prompt to paste
# (also in DIR/.metis/prompt.md): the goal and the lamp's prose, as example/person.py gives them.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
PKGS="$(cd "$HERE/.." && pwd)"
: "${OPENROUTER_API_KEY:?the OpenRouter key from the environment: export OPENROUTER_API_KEY=… (or set -a; . FILE; set +a)}"
export MODEL="${MODEL:-openrouter/deepseek/deepseek-v4-pro:off}"
DIR="${1:-$HOME/lamp-demo-$(date +%Y%m%d-%H%M)}"
[ ! -e "$DIR/domains/lamp" ] || { echo "demo.sh: $DIR has a lamp already: name a new directory" >&2; exit 1; }
mkdir -p "$DIR"
DIR="$(cd "$DIR" && pwd)"
SDK_PY="${METIS_LOOP_SDK_PY:-$PKGS/.venv/bin/python}"
# the lamp's world, laid out in DIR (the plant beside it, the lamp's host, DIR/.metis/)
LLP="$(METIS_LOOP_SDK_PY="$SDK_PY" "$HERE/example/lamp/world.sh" "$DIR")"
export METIS_LOOP_LLP="$LLP"                                  # the REPL starts beside the plant
usage() { "$SDK_PY" "$HERE/example/openrouter_key.py" | "$SDK_PY" -c 'import json,sys; print(json.load(sys.stdin)["usage"])'; }
before="$(usage)"
"$SDK_PY" -c 'import sys; sys.path.insert(0, sys.argv[1] + "/example"); import person
print(person.GOAL + open(sys.argv[1] + "/example/lamp/prose.md").read(), end="")' "$HERE" > "$DIR/.metis/prompt.md"
cat <<EOF
The agentic loop's demo: $MODEL drives pi, and formalizes.
The key has spent $before USD so far. A run costs about 0.01–0.04 USD and takes 2–5 minutes
(three measured runs: README, "The demo").

Paste this as your first message (it is also in $DIR/.metis/prompt.md):
----------------------------------------------------------------------
$(cat "$DIR/.metis/prompt.md")
----------------------------------------------------------------------
Steer by typing while the model works (pi sends it as a steer); every write to the
catalog stops at a "Apply to the catalog …?" box with the diff: you approve or refuse it.
Leave pi with ctrl+c twice (or /quit).

EOF
read -r -p "Press Enter to start pi. " _
st=0; (cd "$DIR" && METIS_CATALOG="$DIR" "$HERE/loop.sh") || st=$?   # DIR, whatever the shell's METIS_CATALOG says
after="$(usage)" || after="$before"            # a failed read must not lose the run's status
"$SDK_PY" -c 'import sys; b, a = map(float, sys.argv[1:3]); print("This run: %.4f USD by the key'"'"'s usage (OpenRouter may add the last calls a minute later)." % (a - b))' "$before" "$after"
echo "The run's files: $DIR (the catalog it wrote: domains/lamp/; the pi session and records/formalize-calls.jsonl in .metis/)."
echo "To exercise the lamp in your catalog (the loop console, the agents): cd $DIR && $HERE/take.sh --into <your catalog>"
exit "$st"
