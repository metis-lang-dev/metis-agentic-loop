// The loop's machinery end to end with the model's choices scripted (docs/LOOP-AGENT.md
// "The worked example"): the same two extensions pi loads, their tools called in the
// loop's order by this script instead of a model, against the real processes — metispy's
// `metis --json`, metis-agent's domain agent with the lamp's world — and the kernel's
// formalize on Ollama. It separates the structural bar (the loop runs through, the calls
// round-trip, the gates hold) from the model's quality, which person.py measures.
//
//   OLLAMA_URL=http://127.0.0.1:11434 node/bin/node --experimental-strip-types \
//     example/scripted.ts DIR          (from this checkout)
//   MODEL=openrouter/deepseek/deepseek-v4-pro …   formalize on OpenRouter instead (the loop
//     SDK's OpenAI-compatible face; OPENROUTER_API_KEY from the environment; the calls and
//     their cost in DIR/.metis/records/formalize-calls.jsonl)
//
// DIR is the catalog (cwd-root s-ddac2cbf): the lamp's world laid out in it (example/lamp/world.sh),
// the script runs there, and its files (scripted.md, scripted.json, metis.toml, records/) go in DIR/.metis/.
import { readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import repl from "../extensions/metis-repl.ts";
import domain from "../extensions/metis-domain.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const PI = join(HERE, "..");
const PKGS = join(PI, "..");                                     // the workspace (its .venv, metis-agent: defaults)
const AGENT = process.env.METIS_AGENT ?? join(PKGS, "metis-agent"); // the domain agent's checkout
const dir = resolve(process.argv[2] ?? "/tmp/loop-scripted");
const ollama = process.env.OLLAMA_URL ?? "http://127.0.0.1:11434";
const model = process.env.MODEL ?? "metis-gemma4-e4b";

const sdkPy = process.env.METIS_LOOP_SDK_PY ?? join(PKGS, ".venv", "bin", "python"); // the loop SDK's model adapters
// the catalog: DIR, the lamp's world laid out in it as a demo does (example/lamp/world.sh); the script runs in it
const cat = dir;
const llp = execFileSync(join(HERE, "lamp", "world.sh"), [cat], { encoding: "utf8", env: { ...process.env, METIS_LOOP_SDK_PY: sdkPy } }).trim();
const st = join(cat, ".metis");
process.chdir(cat);
const conf = join(st, "metis.toml");
const face = model.startsWith("openrouter/")
	? `openai-command --base-url https://openrouter.ai/api/v1 --model ${model.slice("openrouter/".length)} --log ${join(st, "records", "formalize-calls.jsonl")}`
	: `ollama-command --model ${model} --url ${ollama}`;
writeFileSync(conf, `[llm]\nendpoint = "command:${sdkPy} -m metis_loop_sdk.models ${face}"\n`);
Object.assign(process.env, {
	METIS_CATALOG: cat,
	METIS_CONFIG: conf,
	METIS_LOOP_LLP: llp,
	METIS_LOOP_METIS: join(PKGS, ".venv", "bin", "metis"),
	METIS_LOOP_SDK_PY: sdkPy,
	METIS_LOOP_AGENT_PY: join(AGENT, "py", ".venv", "bin", "python"),
	METIS_LOOP_AGENT_DIR: join(AGENT, "py"),
	METIS_LOOP_RECORDS: join(st, "records"),
	METIS_LOOP_RUN: st,
});

const log = join(st, "scripted.md");
writeFileSync(log, `# the loop, scripted (${new Date().toISOString()}; formalize on ${model}${model.startsWith("openrouter/") ? "" : " at " + ollama})\n\n`);
const say = (s: string) => {
	appendFileSync(log, s + "\n");
	console.log(s);
};
const t0 = Date.now();
const secs = () => ((Date.now() - t0) / 1000).toFixed(0);

// a pi stand-in that records what the extensions register, and plays the person at the gate
const tools = new Map<string, any>();
const on = new Map<string, ((e: any, c: any) => any)[]>();
const messages: string[] = [];
const api: any = {
	registerTool: (t: any) => tools.set(t.name, t),
	registerCommand: () => {},
	on: (ev: string, h: any) => on.set(ev, [...(on.get(ev) ?? []), h]),
	sendMessage: (m: any) => {
		messages.push(m.content);
		say(`  **signal → the loop**: ${String(m.content).slice(0, 300)}`);
	},
};
const emit = async (ev: string, e: any, c: any) => {
	let r;
	for (const h of on.get(ev) ?? []) r = await h(e, c);
	return r;
};
let approvals = 0;
const person = { hasUI: true, ui: { notify: () => {}, confirm: async (title: string) => (say(`  **gate**: ${title} — **the person approves**`), approvals++, true) } };

let n = 0;
async function call(name: string, args: Record<string, unknown>, stage: string): Promise<string> {
	const id = `s${++n}`;
	say(`→ \`${name}\` ${JSON.stringify(args)}  _[${stage}; ${secs()} s]_`);
	const blocked = await emit("tool_call", { toolName: name, toolCallId: id, input: args }, person);
	if (blocked?.block) {
		say(`  ← BLOCKED: ${blocked.reason}`);
		return `BLOCKED: ${blocked.reason}`;
	}
	try {
		const r = await tools.get(name).execute(id, args);
		const text = r.content.map((c: any) => c.text).join("\n");
		say(`  ← ${text.slice(0, 900).replace(/\n/g, "\n    ")}`);
		return text;
	} catch (e) {
		say(`  ← ERROR ${(e as Error).message.slice(0, 600)}`);
		return `ERROR ${(e as Error).message}`;
	}
}

const PROGRAM =
	"A desk lamp: the person switches it on or off. catalog lamp 1, one stage main. Declare each atom on its own line: " +
	"pred lit : lamp. pred dark : lamp. pred cmd_on : lamp. pred cmd_off : lamp. pred done(on) : lamp. pred done(off) : lamp. " +
	"pred worn : lamp (the bulb's wear sensor reports it; no rule uses it). Rules: switch_on [dyn] : dark * cmd_on -o lit * done(on). switch_off [dyn] : lit * cmd_off -o dark * done(off). " +
	"on_again [dyn] : cmd_on * $lit -o done(on). off_again [dyn] : cmd_off * $dark -o done(off). " +
	"Each rule has a %% line saying it in words. After the stage, the start state without a dot: #init dark 1";
const EXTENSION =
	"The lamp's bulb wears out: the world reports worn a beat before the bulb burns out, and then the lamp is dark. " +
	"An extension, exactly: catalog lamp_bulb 1. extends lamp. stage main with one rule and no declarations " +
	"(worn, lit and dark are the lamp's): burn_out [dyn] : lit * worn -o dark. Its %% line: My bulb is worn and burns out; I am dark.";

async function main() {
	repl(api);
	domain(api);
	await emit("session_start", {}, person);
	say(`\n## formalize  (${tools.size} tools)\n`);
	await call("repl_text", { arg: PROGRAM }, "formalize");
	say(`\n## the gate holds: an apply before a passed candidate is refused\n`);
	await call("catalog_apply", { domain: "lamp", what: "program" }, "apply");
	say(`\n## formalize, again\n`);
	let ok = false;
	for (let i = 0; i < 3 && !ok; i++) {
		await call("repl_formalize", { arg: "" }, "formalize");
		ok = !(await call("repl_revise", { arg: "" }, "formalize")).startsWith("refused");
	}
	if (!ok) return say("formalize did not pass in 3 drafts: stop");
	say(`\n## apply\n`);
	await call("catalog_apply", { domain: "lamp", what: "program" }, "apply");
	await call("catalog_apply", { domain: "lamp", what: "intents" }, "intents");
	say(`\n## exercise\n`);
	await call("domain_open", { domain: "lamp" }, "exercise");
	await call("intent_on", {}, "exercise");
	const ex = await call("domain_clock", { n: 9 }, "exercise");
	const surprised = /SURPRISE/.test(ex);
	await call("domain_state", { domain: "lamp" }, "exercise");
	if (!surprised) return say("no surprise in 9 beats: stop");
	say(`\n## revise: an extension\n`);
	await call("repl_text", { arg: EXTENSION }, "revise");
	ok = false;
	for (let i = 0; i < 3 && !ok; i++) {
		await call("repl_formalize", { arg: "" }, "revise");
		ok = !(await call("repl_gate", { arg: "" }, "revise")).startsWith("refused");
	}
	if (!ok) return say("the extension did not pass the gate in 3 drafts: stop");
	await call("repl_show", { arg: "llp" }, "revise");
	await call("catalog_apply", { domain: "lamp", what: "extension", name: "bulb" }, "revise");
	say(`\n## re-exercise\n`);
	await call("domain_open", { domain: "lamp" }, "re-exercise");
	await call("intent_on", {}, "re-exercise");
	const re = await call("domain_clock", { n: 9 }, "re-exercise");
	await call("domain_state", { domain: "lamp" }, "re-exercise");
	await call("domain_events", { domain: "lamp" }, "re-exercise");
	const fixed = !/SURPRISE/.test(re);
	say(`\n## end (${secs()} s): ${fixed ? "the burn-out is modelled: no surprise in the re-exercise" : "the re-exercise still surprised"}; ${approvals} approvals; ${n} calls`);
	writeFileSync(join(st, "scripted.json"), JSON.stringify({ seconds: Number(secs()), calls: n, approvals, surprised, fixed }, null, 1));
}

main()
	.catch((e) => say(`FAILED: ${e.stack}`))
	.finally(async () => {
		await emit("session_shutdown", {}, {});
		setTimeout(() => process.exit(0), 1500).unref();
	});
