# tools/pi — the agentic loop's host (docs/LOOP-AGENT.md)

pi hosts the agentic loop. The two metis extensions give it its tools. Everything
pi needs is pinned and installed here, not globally, and no part of the repo
depends on it.

| what | version | where | how |
|---|---|---|---|
| Node | v22.23.3 (2026-09-23; pi needs >= 22.19) | `node/` (gitignored) | `setup.sh`: nodejs.org tarball, SHA-256 checked against SHASUMS256.txt |
| pi | `@earendil-works/pi-coding-agent` 1.3.0 | `node_modules/` (gitignored) | `setup.sh`: `npm ci --ignore-scripts` from `package-lock.json` (integrity hashes) |
| Ollama | 0.24.0 (the host's service) | — | its built-in Gemma 4 renderer and parser |
| model | our Gemma 4 E4B Q5_K_M GGUF (`go/models/gemma4/`) | Ollama: `metis-gemma4-e4b`, `metis-gemma4-e4b-cpu` | `ollama create … -f ollama/Modelfile` (`Modelfile.cpu`: `num_gpu 0`) |

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

## Replay the worked example

```
tools/pi/setup.sh                                              # once
ollama create metis-gemma4-e4b -f tools/pi/ollama/Modelfile    # once (from metis-agent/)
# if `ollama ps` shows the model at "100% CPU": the system service started before the
# NVIDIA driver was ready (it probes the GPU once, at start). Either restart it
# (sudo systemctl restart ollama) or run a user-level server beside it:
#   OLLAMA_HOST=127.0.0.1:11435 OLLAMA_MODELS=/usr/share/ollama/.ollama/models ollama serve &
#   export OLLAMA_URL=http://127.0.0.1:11435
tools/pi/example/person.py /tmp/lamp-run          # the model drives, the scripted person steers/approves (≈ 15–30 min)
tools/pi/node/bin/node --experimental-strip-types tools/pi/example/scripted.ts /tmp/lamp-scripted
                                                  # the loop's machinery with the model's choices scripted (≈ 5 min)
tools/pi/loop.sh --scratch /tmp/lamp-tui          # pi's TUI: you are the person
```

Each run writes its own scratch catalog, the pi session and a transcript
(`transcript.md` or `scripted.md`) into the directory it is given.
