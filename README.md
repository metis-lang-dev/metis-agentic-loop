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
pinned by tag in CI): the model adapters, and the catalog (the extensions read
a domain's intents and make the one write, `catalog_apply`, through its catalog CLI:
`python -m metis_loop_sdk.catalog … --json`). `METIS_AGENT` points elsewhere for
metis-agent; `METIS_LOOP_SDK_PY`, `METIS_LOOP_METIS` and `METIS_LOOP_AGENT_PY` for the pythons.

| what | version | where | how |
|---|---|---|---|
| Node | v22.23.3 (2026-09-23; pi needs >= 22.19) | `node/` (gitignored) | `setup.sh`: nodejs.org tarball, SHA-256 checked against SHASUMS256.txt |
| pi | `@earendil-works/pi-coding-agent` 1.3.0 | `node_modules/` (gitignored) | `setup.sh`: `npm ci --ignore-scripts` from `package-lock.json` (integrity hashes) |
| Ollama | 0.24.0 (the host's service) | — | its built-in Gemma 4 renderer and parser |
| the loop SDK | metis-loop `sdk/` (`metis_loop_sdk.models`, `.catalog`) | the packages venv (`METIS_LOOP_SDK_PY`, default `../.venv/bin/python`) | `pip install -e ../metis-loop/sdk`: the kernel's formalize through its Ollama or OpenAI-compatible command face (thinking off), the GPU probe, and the catalog CLI (a domain's intents, `catalog_apply`) |
| OpenRouter (trial) | pi's built-in provider | `MODEL=openrouter/<id>[:thinking]` | `OPENROUTER_API_KEY` from the environment only, never a file here; `agent/models.json` caps the trial's models at 2048 output tokens and routes them `data_collection: deny`; `example/openrouter_key.py` prints the key's spend (never the key). The kernel's formalize follows the driver (`FORMALIZE_MODEL=openrouter/<id>`, through the loop SDK's `openai-command`: reasoning off, 2048 tokens, `data_collection: deny`, each call and its cost in `records/formalize-calls.jsonl`); `FORMALIZE_MODEL=metis-gemma4-e4b` keeps it on Ollama |
| model | our Gemma 4 E4B Q5_K_M GGUF (metis-agent `go/models/gemma4/`) | Ollama: `metis-gemma4-e4b`, `metis-gemma4-e4b-cpu` | `ollama create … -f ollama/Modelfile` (`Modelfile.cpu`: `num_gpu 0`) |

| file | what |
|---|---|
| `setup.sh` | install / `--check` |
| `pi.sh` | pi with this directory's config (`agent/models.json`: Ollama only, no keys, no OAuth), offline, no built-in tools, context files, skills, prompt templates or MCP, only the two extensions |
| `loop.sh` | the loop: `--scratch DIR` (a scratch catalog with the example's world) or `METIS_CATALOG=…`; `MODEL=ollama/metis-gemma4-e4b[-cpu]`; pi's args (e.g. `--mode rpc`) |
| `extensions/metis-repl.ts` | the REPL (`metis --json`): a tool per wire verb, `catalog_apply` and its gate |
| `extensions/metis-domain.ts` | the domain agent: `domain_open`, `domain_clock`, the REPL API's tools, the intents |
| `prompts/loop-system.md` | the loop's system prompt (replaces pi's coding-assistant prompt) |
| `example/` | the worked example: the lamp's world (`lamp/lamp_host.py`), the person's prose, `person.py` (the person over RPC) |
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
