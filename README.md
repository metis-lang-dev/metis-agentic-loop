# metis-agentic-loop — the agentic loop, hosted in pi (docs/LOOP-AGENT.md)

[![ci](https://github.com/metis-lang-dev/metis-agentic-loop/actions/workflows/ci.yml/badge.svg)](https://github.com/metis-lang-dev/metis-agentic-loop/actions/workflows/ci.yml)

pi hosts the agentic loop. The two metis extensions give it its tools. Everything
pi needs is pinned and installed here, not globally.

**A loop starts in a directory, and that directory is the catalog and the workspace**,
as `cd DIR && claude` makes DIR the project (cwd-root s-ddac2cbf):

```sh
cd DIR && …/metis-agentic-loop/loop.sh                   # pi's loop over DIR (pi's TUI; --mode rpc for a client)
cd DIR && …/loop.sh --seed PATH.llp|PKG_DIR [--name N]   # a seeded start: the seed becomes DIR's domain N
METIS_CATALOG=DIR …/loop.sh                              # the same, started elsewhere
```

DIR's domain packages are the catalog; an empty DIR is an empty catalog (the first
`catalog_apply` writes `DIR/domains/<name>/`); pi runs in DIR; the loop's own state
(records, sessions, the seed's copy, `seed.json`) goes in `DIR/.metis/` (git-ignored when
DIR is a checkout). `catalog_take` takes a finished domain into another catalog only when
one is named (`--into DIR2`, or `METIS_LOOP_TAKE_INTO`). A demo lays out its world in DIR
(the lamp's host and a known domain beside it); a seed copies a program or a package.

**Status: experimental.** The loop for AI agents, beside metis-loop (the loop for
people). Its integration as the principal agentic loop is postponed (loop-sdk
s-9aabd5a0, brief v2); this repository is the pi experiment's home. It moved out of
metis-agent (`tools/pi/`, `docs/LOOP-AGENT.md`) with its history.

**Where it sits.** A checkout beside the other metis-lang-dev checkouts:

```
perotheia-packages/            (any parent directory)
  .venv/                       metispy (`metis`), metis-catalog, metis-loop-sdk
  metis-agentic-loop/          this repository
  metis-agent/                 the domain agent (py/.venv) and the Gemma 4 GGUF (go/models/)
  metis-catalog/               installed in .venv: the demo's plant, the RDDL hosts' tools/ (never a root)
  metis-loop/sdk/              the loop SDK (pip install -e metis-loop/sdk)
```

At run time the loop drives two processes over their JSON-lines wires,
`metis --json` (metispy) and `python -m metis_agent.domain_agent` (metis-agent), and
shares no code with them. Code it shares is the loop SDK's (`metis_loop_sdk`,
pinned by tag in CI): the model adapters, and the catalog. The extensions read
a domain's intents and make the writes (`catalog_apply`, `catalog_edit`, `catalog_take`) through the
SDK's TypeScript face, `metis_loop_sdk/ts/catalog.ts`: one function per verb of its
catalog CLI (`python -m metis_loop_sdk.catalog … --json`), shipped in the SDK's wheel.
`setup.sh` links it as `extensions/sdk` (gitignored; `pi.sh` refreshes the link at each
start), so the py SDK and its TypeScript face are one install and one tag. This
repository keeps only pi's glue: the tools, the gate, `loop.sh`, a thin `take.sh`. `METIS_AGENT` points elsewhere for
metis-agent; `METIS_LOOP_SDK_PY`, `METIS_LOOP_METIS` and `METIS_LOOP_AGENT_PY` for the pythons.

| what | version | where | how |
|---|---|---|---|
| Node | v22.23.3 (2026-09-23; pi needs >= 22.19) | `node/` (gitignored) | `setup.sh`: nodejs.org tarball, SHA-256 checked against SHASUMS256.txt |
| pi | `@earendil-works/pi-coding-agent` 1.3.0 | `node_modules/` (gitignored) | `setup.sh`: `npm ci --ignore-scripts` from `package-lock.json` (integrity hashes) |
| Ollama | 0.24.0 (the host's service) | — | its built-in Gemma 4 renderer and parser |
| the loop SDK | metis-loop `sdk/` (`metis_loop_sdk.models`, `.catalog`, `ts/catalog.ts`) | the packages venv (`METIS_LOOP_SDK_PY`, default `../.venv/bin/python`); `extensions/sdk` links its TypeScript face | `pip install -e ../metis-loop/sdk`, then `./setup.sh --link`: the kernel's formalize through its Ollama or OpenAI-compatible command face (thinking off), the GPU probe, and the catalog (a domain's intents, `catalog_apply`, `catalog_take`, the README of a run, the bundle) |
| OpenRouter (trial) | pi's built-in provider | `MODEL=openrouter/<id>[:thinking]` | `OPENROUTER_API_KEY` from the environment only, never a file here; `agent/models.json` caps the trial's models at 2048 output tokens and routes them `data_collection: deny`; `example/openrouter_key.py` prints the key's spend (never the key). The kernel's formalize follows the driver (`FORMALIZE_MODEL=openrouter/<id>`, through the loop SDK's `openai-command`: reasoning off, 2048 tokens, `data_collection: deny`, each call and its cost in `records/formalize-calls.jsonl`); `FORMALIZE_MODEL=metis-gemma4-e4b` keeps it on Ollama |
| model | our Gemma 4 E4B Q5_K_M GGUF (metis-agent `go/models/gemma4/`) | Ollama: `metis-gemma4-e4b`, `metis-gemma4-e4b-cpu` | `ollama create … -f ollama/Modelfile` (`Modelfile.cpu`: `num_gpu 0`) |

| file | what |
|---|---|
| `setup.sh` | install / `--check` / `--link` (`extensions/sdk`: the loop SDK's TypeScript face, as installed) |
| `pi.sh` | pi with this directory's config (`agent/models.json`: Ollama only, no keys, no OAuth), offline, no built-in tools, context files, skills, prompt templates or MCP, only the two extensions; the TUI in regular mode (the gate's diff stays in the terminal's scrollback, its Yes/No below it) |
| `take.sh` | `cd DIR && take.sh --into DIR2 [NAME]`: `catalog_take` from the shell, after the session: a domain the loop made in DIR (default lamp) into DIR2, three calls of the loop SDK's CLI (`take --readme-from-run DIR/.metis`, its dry run, `build`); never a commit |
| `loop.sh` | the loop over the directory it starts in (`METIS_CATALOG=DIR` from elsewhere); `--seed PATH.llp|PKG_DIR [--name NAME] [--episodes N]`: a seeded start ("A seeded start" below); `--into DIR2`: catalog_take's target; `MODEL=ollama/metis-gemma4-e4b[-cpu]`; pi's args (e.g. `--mode rpc`) |
| `extensions/metis-repl.ts` | the REPL (`metis --json`): a tool per wire verb, `catalog_apply` (what=program, served, extension, intents, readme), `catalog_edit` (one exact edit of a domain's file, comments and all), `catalog_take` (a finished domain into `METIS_LOOP_TAKE_INTO`) and their gate, which shows a refused file's next proposal as its diff from the refused one; `lib/roots.ts`: which catalog each write goes to |
| `extensions/metis-domain.ts` | the domain agent: `domain_open`, `domain_clock`, the REPL API's tools, the intents; for a world without intents `domain_ports`, `domain_world` and `domain_episodes` (seeded episodes measured against the world: outcomes, the program's likelihood of what it did, surprises, mismatched atoms) |
| `prompts/loop-system.md` | the loop's system prompt (replaces pi's coding-assistant prompt); `seed-task.md`, a seeded start's first message |
| `example/` | the worked example: the lamp's world (`lamp/lamp_host.py`; `lamp/world.sh DIR` lays it out in a catalog), the person's prose, `person.py` (the person over RPC); `seeded.ts`, a seeded start scripted end to end (no model); `seedperson.py`, a seeded run over RPC with a human at every gate, through files (`DIR/.metis/ask/<n>.md` → `<n>.ans`: y, or n and a steer), with a cost cap |
| `test/` | `extensions.test.ts`, the extensions against stand-ins (no model): `node/bin/node --experimental-strip-types --test test/extensions.test.ts` |

## The demo

One command, in pi's TUI, where you are the person. **DeepSeek V4 Pro** (`deepseek/deepseek-v4-pro` on OpenRouter) both drives pi and drafts through the kernel's formalize:
- reasoning off;
- at most 2048 output tokens per call;
- providers that keep no prompts (`data_collection: deny`).

```
./setup.sh                                   # once
export OPENROUTER_API_KEY=…                  # or: set -a; . ~/.config/metis/openrouter.env; set +a
./demo.sh                                    # mkdir ~/lamp-demo-<date>-<time>, the lamp's world in it, loop.sh there; or ./demo.sh DIR
```

**What it costs:** about **0.01–0.04 USD** and 2–5 minutes per run. Three measured runs (agentic-loop s-3ddb3e87 step 2), by the key's usage:

| run | cost | time |
|---|---|---|
| 1 | 0.037 USD | 4.3 min (it stopped short and was nudged on) |
| 2 | 0.013 USD | 1.6 min |
| 3 | 0.012 USD | 2.0 min |

The kernel's formalize was about 0.001 of each. `demo.sh` prints the key's spend before and after; it never prints the key.

**What you do:**
1. **Paste the prompt** `demo.sh` prints (the goal and the lamp's prose; also in `DIR/.metis/prompt.md`).
2. **The model formalizes.** If its draft keeps failing, steer: type the rules as `example/person.py`'s `STEER_FORMALIZE` gives them. Typing while the model works sends a steer, which pi delivers before its next step.
3. **The apply gate asks** before every write to the catalog: a box `Apply to the catalog …: domains/lamp/lamp.llp (new)…?` with the diff. You approve or refuse it. It asks three times:
   - the program;
   - its intents;
   - the extension (`domains/lamp/extensions/<name>.llp`).

   **Read the extension's rule before you approve: its premise must name a cause.** The right one is `lit * worn -o dark`. A bare `lit -o dark` makes every lit lamp go dark; refuse it and say why. The gate checks that the extension is well formed, not that it explains: in one of the three runs it did not (run 2's `decay_lit : lit -o dark`).

   The revise step (`prompts/loop-system.md` step 6) asks for an extension whose atoms the domain already declares. That holds here: the prose declares `worn` up front. A cause the domain does not declare would need a `pred` of the extension's own; the prompt does not ask for one yet.
4. **Exercise.** If the model only reads the lamp, steer: "switch it on with intent_on, then domain_clock 8 beats". The surprise comes at beat 6: the bulb wears out (`do +worn` at beat 4) and the lamp goes dark.
5. **The re-exercise** opens the lamp again. The extension's rule fires (`event …: …`) and no surprise comes. The loop is through.

Leave pi with ctrl+c twice. `DIR` is the catalog the run wrote (`domains/lamp/` beside the plant); `DIR/.metis/` keeps:
- the pi session;
- `records/formalize-calls.jsonl` (each formalize call, its tokens and cost).

**Take the lamp into your catalog** to exercise it beside the dog (the loop console, the agents). Start the demo with `METIS_LOOP_TAKE_INTO=<your catalog>` (or `loop.sh --into DIR2`); in pi, when the loop is through, say "take the lamp into my catalog": the model calls `catalog_take domain=lamp`, and the gate shows the diff into it. Without a catalog named, `catalog_take` refuses. After the session, `cd DIR && ./take.sh --into <your catalog>` does the same from the shell.

DIR holds the plant beside the lamp, so copying it over is wrong. Both take the one domain through the loop SDK (`take lamp --from DIR --readme-from-run DIR/.metis`). It brings domain.yaml, the program, the extensions, the host and intent.yaml (intent/ generated again), and writes a README of the run (the SDK's `readme`: the model and formalize's cost, or the seed). It refuses a domain the catalog has already, builds the bundle (`build/`, git-ignored, as the dog's), and never commits.

## A seeded start

`cd DIR && loop.sh --seed PATH.llp [--name NAME]` starts from an existing program instead of prose: the six fiction programs (once `metis-catalog/domains/fiction/*.llp`) became catalog domains this way (fiction-port step 2: `domains/love_triangle/`, `tragedy/`, `herstory/`, `talespin/`, `three_pigs/`, `three_pigs_connectives/`; under `domains/ceptre/` since, the Ceptre ports' own license).
- The REPL serves a copy of the seed (`DIR/.metis/seed/NAME.llp`); `DIR/.metis/seed.json` records it. NAME defaults to the file's stem with `-` as `_` (`3lp` needs `--name`); a DIR that has a domain NAME already is not seeded over it. A DIR is seeded once: another seed needs a new DIR (a plain `loop.sh` goes on working in it). `--episodes N` (1–50, default 20) is the n of the task's `domain_episodes` for an RDDL world: it is in the task from its first message, so the model never runs another n before the person's (rddl-watch s-cfe94dca).
- pi's first message is the seeded task (`prompts/seed-task.md`, also `DIR/.metis/seed/task.md`; over `--mode rpc` the client sends it):
  1. read the program (`repl_show base`);
  2. `catalog_apply what=served display=… line=…`: the seed, as it is, becomes the domain's program, its manifest with a display and a line. The gate shows it, and its rules are not changed: never formalize or revise, which reprint the program without its comments. A change the person asks for (a comment, a header line, one rule) is `catalog_edit` with the exact old and new text, its diff at the gate. Until the seed is applied, a seeded run refuses what=program and what=extension for a domain its catalog does not have, so a change to the seed always reaches the gate as a diff against it, never as a new file;
  3. `catalog_apply what=intents`: the person's verbs from its `cmd_*` atoms. A world without commands gets no intent.yaml (the agents open a domain without intents with no verbs, metis-agent a0a19e6), and nothing reaches the gate; `METIS_CATALOG_INTENTLESS=0` (the SDK's switch) gives one that knows only UNKNOWN for older agents;
  4. exercise: `domain_open`, `domain_clock`, `domain_state`, `domain_events`;
  5. `catalog_apply what=readme title=… text=…`: the README, gated. The model writes the title and one summary paragraph, each claim from a rule, a header line or an output of the session; the SDK writes the rest from the files: where it came from, the program's header verbatim, its extensions, how to run its case (`metisc --run`, its `#` lines) and the REPL line, and the intents' status. A fix is `catalog_edit path=README.md`, never the whole text again;
  6. when the person asks, `catalog_take`. It carries the README (a domain without one gets the SDK's, which names the seed).
- `example/seeded.ts SEED.llp|PKG_DIR DIR [NAME]` runs those calls with no model (no cost), against the real processes, in DIR (made empty), takes the domain into `DIR.into` beside it, and checks each step, a header comment edited through `catalog_edit` with every comment kept. All six fiction programs pass it.
- **A package seed**, `--seed domains/<name>/` (rddl-worlds s-242c7c3f: nav and the other RDDL worlds): the package is copied whole into `DIR/.metis/seed/domains/NAME/` (NAME: the directory's name; build/ and records/ left out), a catalog of its own (an RDDL host finds `tools/rddl_host.py` in the installed metis-catalog: `loop.sh` puts its `tools/` on PYTHONPATH), and the REPL serves its program there with its host, so its includes resolve. `catalog_apply what=served` takes the whole package into the loop's catalog through the gate: the program, the files it includes, the host, domain.yaml and the README as they are. `catalog_take` carries the included files as well.
- **A world without intents** (an RDDL world: its program acts, its host is the gym) is exercised through its world: `domain_ports` (the gym, the observed and derived atoms, the actions, the weight ports), `domain_world` (world lines for a scenario), `domain_clock`, and `domain_episodes {n, seed, world?}`. It runs n episodes, each a reset with its seed, with every beat scored by the domain agent (`{"clock": "beat", "score": true}`). For each action the program sent, it scores P(the world's answer | that action): the same-action alternatives whose effect is the gym's reading, over them all. So a wrong rate shows as a lower likelihood, not only an impossible answer as a surprise. A beat in which the program sent no action (every beat of an observing world, wildfire or tamarisk, where the host acts) is scored apart by P(the host's reading | the beat's last input), and a p = 0 there makes the episode zero-probability. A lockstep or followed world's reading is priced by the watch on a declared tier (rddl-watch s-cfe94dca): exact within a state budget, else sampled (500 seeded runs). A sampled zero is no run reaching the reading, below the tier's resolution (p < 0.0076 at 95%), not impossible: it is counted apart and never makes the episode zero-probability, and the tier is printed with the reading per beat. It answers the outcome frequencies, the gym's reward, that likelihood per episode and the least likely answers, the surprises, and the mismatched atoms grouped. The exercise records; it fixes nothing.
- `example/seedperson.py DIR --seed PATH.llp [--max-usd X]` runs a seeded start on a model with a person who is not at the TUI: at each gate it writes the question to `DIR/.metis/ask/<n>.md` (the diff), names it in `DIR/.metis/WAITING`, and waits for `<n>.ans`.

`MODEL=openrouter/<id>:off ./demo.sh` runs another OpenRouter model; formalize follows it.

## Replay the worked example

```
./setup.sh                                              # once
ollama create metis-gemma4-e4b -f ollama/Modelfile    # once (from this checkout)
# loop.sh probes the server first (python -m metis_loop_sdk.models ollama-probe --model M --load)
# and warns when the model runs on the CPU: the system service started before the
# NVIDIA driver was ready (it probes the GPU once, at start). Either restart it
# (sudo systemctl restart ollama) or run a user-level server beside it:
#   OLLAMA_HOST=127.0.0.1:11435 OLLAMA_MODELS=/usr/share/ollama/.ollama/models ollama serve &
#   export OLLAMA_URL=http://127.0.0.1:11435
./example/person.py /tmp/lamp-run          # the model drives, the scripted person steers/approves (≈ 15–30 min)
./node/bin/node --experimental-strip-types example/scripted.ts /tmp/lamp-scripted
                                                  # the loop's machinery with the model's choices scripted (≈ 5 min)
example/lamp/world.sh /tmp/lamp-tui && cd /tmp/lamp-tui && \
  METIS_LOOP_LLP=$PWD/domains/plant/plant.llp …/loop.sh    # pi's TUI: you are the person
```

Each run lays out the lamp's world in the directory it is given (the catalog it writes)
and keeps the pi session and a transcript (`transcript.md` or `scripted.md`) in its `.metis/`.

## License

Apache License 2.0 (see `LICENSE`, `NOTICE`).
