# The agentic loop — an agent that refines a formalization, hosted in pi

agentic-loop s-3ddb3e87 step 1 (nina, 2026-10-16; architect brief v2). The code
is in this repository (metis-agentic-loop): two thin pi extensions, the Ollama Modelfile, the launcher
and the worked example.

## The cut

- **metis-loop is the person's loop**: its consoles and its UI. The agentic loop
  shares **nothing** with its human loop. Code that has to stay the same in every
  consumer is metis-loop's SDK (`metis_loop_sdk`, loop-sdk s-9aabd5a0): this loop
  uses its model adapters (the kernel's formalize on Ollama or, through the
  OpenAI-compatible face, on OpenRouter, thinking off either way; the GPU probe).
- Both loops stand on the same two lower layers:
  - the **metis REPL** (metispy), over its JSON-lines wire (`metis --json`);
  - **metis-agent's lower half**: the domain agent (`python -m
    metis_agent.domain_agent`), with intents J from the catalog and the REPL API T
    from metispy's `tools.json`.
- **Parity of capabilities.** The loop's tools are generated from those two
  interfaces' own declarations. Nothing is written for pi that the interfaces do
  not declare, and nothing they declare is left out.
- The one capability neither interface has is writing into the catalog. That
  write is `catalog_apply`, behind the person's gate; `catalog_edit`, one exact
  edit of a domain's file (old text → new, every other byte kept), and
  `catalog_take`, which takes a finished domain from the loop's catalog into the
  person's, are behind the same gate. pi's own edit tool stays off: it would
  write past the gate, the SDK's checks and the roots.
- **Host: pi** (`@earendil-works/pi-coding-agent`, pinned in this repository).
  - Built-in tools, context files, skills, prompt templates and MCP are all off.
  - The system prompt is the loop's own (`prompts/loop-system.md`).
- **Model, version 1:** Ollama with our Gemma 4 E4B GGUF (`ollama/`).
  - No API keys.
  - pi's Claude OAuth is never used.
  - The `claude -p` route for pi is postponed with pi as the principal loop
    (loop-sdk brief v2).

## The loop as a state machine

AGENT-LOOP.md's steps, each with the tools it uses and the state it leaves behind:

| state | what happens | tools | leaves |
|---|---|---|---|
| **start** | the person gives a goal and prose (pi: a prompt) | — | the session |
| **formalize** | the prose goes into the REPL; the program is drafted by the kernel's own formalize (its `[llm]`: the driver's model, or `FORMALIZE_MODEL`) and checked as a whole program | `repl_text`, `repl_formalize`, `repl_revise`, `repl_show` | a candidate that passed `revise` |
| **apply** | the candidate is written into the catalog, gated (the person sees the loop SDK's dry-run diff), through the SDK's one validated write (`python -m metis_loop_sdk.catalog apply`); the REPL then serves it | `catalog_apply` what=program | the domain's program, plus `domain.yaml` when there is none |
| **intents** | the person's verbs are drafted from the program's `cmd_*` atoms and `%%` lines (the SDK's `catalog intents --skeleton`; `apply --intents` writes it and generates its files), gated | `catalog_apply` what=intents | `intent.yaml` and `intent/` |
| **exercise** | the domain agent runs the domain, the loop owning its clock | `domain_open`, `intent_<verb>`, `domain_clock`, `domain_state` / `why` / `events` / `ctx` / `findings` | the agent's records (`--records`) |
| **exercise (no intents)** | a world without intents (an RDDL world, its host the gym) is exercised through its world: its ports, world lines, beats, and seeded episodes measured, every beat scored (per action, P(the world's answer \| that action) under the program); recorded, not fixed | `domain_ports`, `domain_world`, `domain_clock`, `domain_episodes` | the measure: outcomes, likelihood, surprises, mismatched atoms |
| **surprise** | the world reads differently from the program; a message enters the loop | (a signal) | an open record |
| **revise** | the missing behaviour is described, drafted as an extension, and gated as one | `repl_mine`, `repl_formalize`, `repl_gate`, `repl_show` | a candidate that passed `gate` |
| **apply** | the extension is written, gated | `catalog_apply` what=extension | `domains/<n>/extensions/<name>.llp` |
| **re-exercise** | the domain is opened again on the catalog as it is now; the same situation must now be explained | `domain_open`, … | an explained record, or no surprise |
| **seed** | a seeded start (`loop.sh --seed PATH.llp`): the REPL serves an existing program, and it becomes the domain's program as it is, gated; formalize and revise are skipped | `catalog_apply` what=served | the domain's program and `domain.yaml` |
| **edit** | a small change to a file the catalog has (a comment, a header line, a README sentence, a value, one rule's text): the SDK's `edit`, old_string exactly once (or replace_all), the path inside the domain, a `.llp` edit adding no metisc diagnostic; never formalize or revise | `catalog_edit` | that one file |
| **take** | when the person asks: the domain is taken from the loop's catalog (the directory it runs in) into the person's (`METIS_LOOP_TAKE_INTO`, `loop.sh --into DIR2`) through the SDK's `take`, with a README of the run and its bundle, gated, never a commit | `catalog_take` | `domains/<n>/` in the person's catalog |
| **stop** | the person stops the run | (pi: abort) | the session file |

**The person's entries, all through pi** (the TUI, or RPC for a client):

| entry | pi |
|---|---|
| start | a prompt: the goal and the prose |
| steer | `steer` (delivered after the current tool batch) or `follow_up` (after the run) |
| approve | the `tool_call` gate on `catalog_apply`, `catalog_edit` and `catalog_take`: `ctx.ui.confirm`, which the TUI shows and RPC forwards as `extension_ui_request`. A file the person refused shows, at its next proposal, the diff from the refused text first, then the diff against the disk |
| stop | `abort` |

**The later autonomous entry** (step 2): a served domain spills surprise records,
and each record starts a revise cycle without a person's prompt. Apply stays
gated: an autonomous cycle ends at the gate and waits there for the person.

**Who decides what.**

- **The extensions' code** decides nothing about the domain. It:
  - spawns and holds the two processes;
  - generates the tools from the interfaces' declarations;
  - passes calls through;
  - turns unasked lines into messages;
  - refuses an apply whose candidate has not passed its gate (`show`: `gated`).
- **The model** decides the order of calls within a state, the text it puts into
  the REPL, which intents to say and how long to run the clock, what a surprise
  means, and when to move to the next state.
- **The person** decides every write into the catalog, and steers and stops.

**Budgets per cycle.** These are the person's defaults in the worked example
(`example/person.py`), not enforced by the extensions:

- one formalize-and-apply;
- up to 8 "continue" nudges when the model stops early;
- a wall-clock limit for the run (`--minutes`);
- a clock call takes 1–50 beats.

The kernel's formalize has its own repair rounds.

## The extensions (`extensions/`)

| file | process | tools | glue |
|---|---|---|---|
| `metis-repl.ts` | one `metis --json [llp]` per session; reopened on the applied program | `repl_<verb>` for every verb the wire's `help` lists (39 today), each with the description the wire declares; `catalog_apply`, `catalog_edit`, `catalog_take`; the `tool_call` gate | see the report |
| `metis-domain.ts` | one `domain_agent --domain <n> --case replay --consult template [--records DIR]` per `domain_open` | `domain_open`, `domain_clock`, `domain_ports`, `domain_world`, `domain_episodes`; `domain_<tool>` for every tool of `metis --tools-json` served by the domain agent (served_by repl / watch / agent: state, ctx, events, why, findings, consult, reset, explain, escalate); `intent_<verb>` for every verb of the domain's `intent.yaml` | |
| `lib/jsonl.ts` | — | a JSON-lines child: one request, the lines until its answer, unasked lines to a callback | |

pi facts relied on:

- `pi.registerTool` (TypeBox schema, async `execute`) at `session_start` and later,
  from a tool's `execute` (dynamic registration);
- `pi.on("tool_call")` is awaited and may return `{block, reason}`;
- `pi.sendMessage(…, {deliverAs: "steer", triggerTurn: true})` for signals;
- `session_shutdown` closes the processes;
- `ctx.ui.confirm` works in the TUI and over RPC;
- `--no-builtin-tools --no-context-files --no-skills --no-prompt-templates
  --no-mcp --no-extensions -e …` (`pi.sh`).

**Signals.** A domain agent's unasked lines (event, quiescence, surprise) and its
intents' late outcomes arrive while the loop runs the clock. They are returned as
the `domain_clock` result, and a surprise also enters the loop as a message
steered into the next turn: the model must read it before its next decision.
A REPL `watch`'s signals do the same.

A program that never settles (`persist_lit : lit -o lit`) does not hang the
clock. The domain agent stops each beat at its step cap (`BEAT_STEPS`, 200;
metis-agent 59cc65b). The result says `UNSETTLED quiescence`, with the rules
that kept firing (`unsettled [[rule, times], …]`), and the clock does not
advance until the program is revised. In one `domain_clock` result, the same
event said again is one line with its count and its beats: `event persist_dark
fired ×200, beat 0: …`.

**Findings against the interfaces** (not fixed in pi; the extensions show them as they are):

1. The REPL wire's `help` declares descriptions for 8 of its 39 verbs (the REPL
   API's reads and surprise verbs). The other 31, among them `text`, `formalize`,
   `gate`, `revise`, `mine`, `show` and `run`, have descriptions as their
   docstrings (`metis.loop.verbs`, `metis.lang.repl`) that the wire does not
   publish.
   - Their pi tools carry the marker "(the REPL's wire declares no description for
     this verb — finding: metispy)".
   - The loop's system prompt names the stage verbs.

## Run it

```
./setup.sh                                    # node v22.23.3 + pi 1.3.0 into this checkout (once)
ollama create metis-gemma4-e4b -f ollama/Modelfile     # the GPU model (…-cpu: Modelfile.cpu)
example/lamp/world.sh /tmp/loop && cd /tmp/loop && …/loop.sh   # pi's TUI over a catalog with the lamp's world
./example/person.py /tmp/run1                 # the worked example, the person scripted over RPC
```

## The worked example

The domain is a desk lamp: new, not in the catalog. Its world is
`example/lamp/lamp_host.py`, the robot's driver that exists before any
program. The bulb burns out after 6 lit beats; it reports `+worn` a beat before.

The person's prose (`example/lamp/prose.md`) names the world's atoms, and the
loop formalizes a program over them. Exercising it, a burn-out reads `dark`
while the program says `lit`: the surprise. The extension `lit * worn -o dark`
explains the next burn-out.

The results are in steps/step1-report.md.
