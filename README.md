# metis-agentic-loop — the agentic loop, hosted in pi (docs/LOOP-AGENT.md)

pi hosts the agentic loop. The two metis extensions give it its tools. Everything
pi needs is pinned and installed here, not globally.

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
  metis-catalog/               the catalog the scratch runs copy
  metis-loop/sdk/              the loop SDK (pip install -e metis-loop/sdk)
```

At run time the loop drives two processes over their JSON-lines wires,
`metis --json` (metispy) and `python -m metis_agent.domain_agent` (metis-agent), and
shares no code with them. Code it shares is the loop SDK's (`metis_loop_sdk`,
pinned by tag in CI): the model adapters, and the catalog. The extensions read
a domain's intents and make the writes (`catalog_apply`, `catalog_take`) through the
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
| `take.sh` | `take.sh DIR [NAME]`: `catalog_take` from the shell, after the session: a run's domain (default lamp) into the catalog, three calls of the loop SDK's CLI (`take --readme-from-run DIR`, its dry run, `build`); never a commit |
| `loop.sh` | the loop: `--scratch DIR` (a scratch catalog with the example's world) or `METIS_CATALOG=…`; `--scratch DIR --seed PATH.llp [--name NAME]`: a seeded start ("A seeded start" below); `MODEL=ollama/metis-gemma4-e4b[-cpu]`; pi's args (e.g. `--mode rpc`) |
| `extensions/metis-repl.ts` | the REPL (`metis --json`): a tool per wire verb, `catalog_apply` (what=program, served, extension, intents, readme), `catalog_take` (a finished domain into `METIS_LOOP_TAKE_INTO`) and their gate; `lib/roots.ts`: which catalog each write goes to |
| `extensions/metis-domain.ts` | the domain agent: `domain_open`, `domain_clock`, the REPL API's tools, the intents |
| `prompts/loop-system.md` | the loop's system prompt (replaces pi's coding-assistant prompt); `seed-task.md`, a seeded start's first message |
| `example/` | the worked example: the lamp's world (`lamp/lamp_host.py`), the person's prose, `person.py` (the person over RPC); `seeded.ts`, a seeded start scripted end to end (no model) |
| `test/` | `extensions.test.ts`, the extensions against stand-ins (no model): `node/bin/node --experimental-strip-types --test test/extensions.test.ts` |

## The demo

One command, in pi's TUI, where you are the person. **DeepSeek V4 Pro** (`deepseek/deepseek-v4-pro` on OpenRouter) both drives pi and drafts through the kernel's formalize:
- reasoning off;
- at most 2048 output tokens per call;
- providers that keep no prompts (`data_collection: deny`).

```
./setup.sh                                   # once
export OPENROUTER_API_KEY=…                  # or: set -a; . ~/.config/metis/openrouter.env; set +a
./demo.sh                                    # a fresh ~/lamp-demo-<date>-<time>; or ./demo.sh DIR
```

**What it costs:** about **0.01–0.04 USD** and 2–5 minutes per run. Three measured runs (agentic-loop s-3ddb3e87 step 2), by the key's usage:

| run | cost | time |
|---|---|---|
| 1 | 0.037 USD | 4.3 min (it stopped short and was nudged on) |
| 2 | 0.013 USD | 1.6 min |
| 3 | 0.012 USD | 2.0 min |

The kernel's formalize was about 0.001 of each. `demo.sh` prints the key's spend before and after; it never prints the key.

**What you do:**
1. **Paste the prompt** `demo.sh` prints (the goal and the lamp's prose; also in `DIR/prompt.md`).
2. **The model formalizes.** If its draft keeps failing, steer: type the rules as `example/person.py`'s `STEER_FORMALIZE` gives them. Typing while the model works sends a steer, which pi delivers before its next step.
3. **The apply gate asks** before every write to the catalog: a box `Apply to the catalog …: domains/lamp/lamp.llp (new)…?` with the diff. You approve or refuse it. It asks three times:
   - the program;
   - its intents;
   - the extension (`domains/lamp/extensions/<name>.llp`).

   **Read the extension's rule before you approve: its premise must name a cause.** The right one is `lit * worn -o dark`. A bare `lit -o dark` makes every lit lamp go dark; refuse it and say why. The gate checks that the extension is well formed, not that it explains: in one of the three runs it did not (run 2's `decay_lit : lit -o dark`).

   The revise step (`prompts/loop-system.md` step 6) asks for an extension whose atoms the domain already declares. That holds here: the prose declares `worn` up front. A cause the domain does not declare would need a `pred` of the extension's own; the prompt does not ask for one yet.
4. **Exercise.** If the model only reads the lamp, steer: "switch it on with intent_on, then domain_clock 8 beats". The surprise comes at beat 6: the bulb wears out (`do +worn` at beat 4) and the lamp goes dark.
5. **The re-exercise** opens the lamp again. The extension's rule fires (`event …: …`) and no surprise comes. The loop is through.

Leave pi with ctrl+c twice. `DIR` keeps:
- the catalog the run wrote;
- the pi session;
- `records/formalize-calls.jsonl` (each formalize call, its tokens and cost).

**Take the lamp into the catalog** to exercise it beside the dog (the loop console, the agents). In pi, when the loop is through, say "take the lamp into my catalog": the model calls `catalog_take domain=lamp`, and the gate shows the diff into `../metis-catalog` (`METIS_LOOP_TAKE_INTO`, which `loop.sh --scratch` sets). After the session, `./take.sh DIR` does the same from the shell (into `METIS_CATALOG`, default `../metis-catalog`).

The run's catalog is a scratch one (`tools/`, the plant beside the lamp), so copying it over is wrong. Both take the one domain through the loop SDK (`take lamp --from DIR/catalog --readme-from-run DIR`, sdk-v0.1.3). It brings domain.yaml, the program, the extensions, the host and intent.yaml (intent/ generated again), and writes a README of the run (the SDK's `readme`: the model and formalize's cost, or the seed). It refuses a domain the catalog has already, builds the bundle (`build/`, git-ignored, as the dog's), and never commits.

## A seeded start

`loop.sh --scratch DIR --seed PATH.llp [--name NAME]` starts from an existing program instead of prose: the six fiction programs (once `metis-catalog/domains/fiction/*.llp`) became catalog domains this way (fiction-port step 2: `domains/love_triangle/`, `tragedy/`, `herstory/`, `talespin/`, `three_pigs/`, `three_pigs_connectives/`).
- The REPL serves a copy of the seed (`DIR/seed/NAME.llp`); `DIR/seed.json` records it. NAME defaults to the file's stem with `-` as `_` (`3lp` needs `--name`). A run is seeded once: another seed needs a new DIR.
- pi's first message is the seeded task (`prompts/seed-task.md`, also `DIR/seed/task.md`; over `--mode rpc` the client sends it):
  1. read the program;
  2. `catalog_apply what=served`: the seed, as it is, becomes the domain's program. The gate shows it, and its rules are not changed: no formalize, no revise, unless the person asks for a change and approves its diff. Until the seed is applied, a seeded run refuses what=program and what=extension for a domain its catalog does not have, so a change to the seed always reaches the gate as a diff against it, never as a new file;
  3. `catalog_apply what=intents`: the person's verbs from its `cmd_*` atoms. A world without commands gets an intent.yaml that knows only UNKNOWN, because the domain agent opens no domain without one;
  4. exercise: `domain_open`, `domain_clock`, `domain_state`, `domain_events`;
  5. `catalog_apply what=readme text=…`: the README, gated: what the world is, and its origin and versions as the program's header gives them;
  6. when the person asks, `catalog_take`. It carries the README (a domain without one gets the SDK's, which names the seed).
- `example/seeded.ts SEED.llp DIR [NAME]` runs those calls with no model (no cost), against the real processes, into the scratch target `DIR/into`, and checks each step. All six fiction programs pass it.

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
./loop.sh --scratch /tmp/lamp-tui          # pi's TUI: you are the person
```

Each run writes its own scratch catalog, the pi session and a transcript
(`transcript.md` or `scripted.md`) into the directory it is given.
