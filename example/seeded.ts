// A seeded start end to end, scripted (fiction-port s-e3d0942d step 1): the loop's tools
// called in the seeded task's order (prompts/seed-task.md) by this script instead of a
// model, against the real processes — metispy's `metis --json` serving the seed,
// metis-agent's domain agent, the loop SDK's catalog — into a scratch target catalog.
// No model: a seeded start formalizes nothing, so the run costs nothing.
//
//   node/bin/node --experimental-strip-types example/seeded.ts SEED.llp DIR [NAME]
//
// DIR gets the run as loop.sh --scratch DIR --seed SEED makes it (catalog/, seed/,
// seed.json, records/), the target catalog DIR/into (tools/ and an empty domains/),
// seeded.md (the calls and their answers) and seeded.json (what held). Exit 1 when any
// check fails.
import { appendFileSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import repl from "../extensions/metis-repl.ts";
import domain from "../extensions/metis-domain.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const PKGS = join(HERE, "..", "..");                              // the sibling checkouts
const AGENT = process.env.METIS_AGENT ?? join(PKGS, "metis-agent");
const seed = resolve(process.argv[2] ?? "");
const dir = resolve(process.argv[3] ?? "/tmp/loop-seeded");
const name = process.argv[4] ?? basename(seed, ".llp").replace(/-/g, "_");
if (!existsSync(seed)) throw new Error(`usage: seeded.ts SEED.llp DIR [NAME] (no seed at ${seed})`);

// the run, as loop.sh --scratch DIR --seed SEED --name NAME lays it out
rmSync(dir, { recursive: true, force: true });
const cat = join(dir, "catalog"), into = join(dir, "into");
for (const c of [cat, into]) {
	mkdirSync(join(c, "domains"), { recursive: true });
	cpSync(join(PKGS, "metis-catalog", "tools"), join(c, "tools"), { recursive: true });
}
mkdirSync(join(dir, "seed"));
mkdirSync(join(dir, "records"));
cpSync(seed, join(dir, "seed", `${name}.llp`));
const rel = seed.startsWith(join(PKGS, "metis-catalog") + "/") ? seed.slice(join(PKGS, "metis-catalog").length + 1) : seed;
writeFileSync(join(dir, "seed.json"), JSON.stringify({ seed: rel, name }));
Object.assign(process.env, {
	METIS_CATALOG: cat,
	METIS_LOOP_TAKE_INTO: into,
	METIS_LOOP_RUN: dir,
	METIS_LOOP_RECORDS: join(dir, "records"),
	METIS_LOOP_LLP: join(dir, "seed", `${name}.llp`),
	METIS_LOOP_METIS: process.env.METIS_LOOP_METIS ?? join(PKGS, ".venv", "bin", "metis"),
	METIS_LOOP_SDK_PY: process.env.METIS_LOOP_SDK_PY ?? join(PKGS, ".venv", "bin", "python"),
	METIS_LOOP_AGENT_PY: process.env.METIS_LOOP_AGENT_PY ?? join(AGENT, "py", ".venv", "bin", "python"),
	METIS_LOOP_AGENT_DIR: process.env.METIS_LOOP_AGENT_DIR ?? join(AGENT, "py"),
});

const log = join(dir, "seeded.md");
writeFileSync(log, `# a seeded start, scripted (${new Date().toISOString()}): ${rel} as the domain ${name}\n\n`);
const say = (s: string) => {
	appendFileSync(log, s + "\n");
	console.log(s);
};

// a pi stand-in that records what the extensions register, and plays the person at the gate
const tools = new Map<string, any>();
const on = new Map<string, ((e: any, c: any) => any)[]>();
const api: any = {
	registerTool: (t: any) => tools.set(t.name, t),
	registerCommand: () => {},
	on: (ev: string, h: any) => on.set(ev, [...(on.get(ev) ?? []), h]),
	sendMessage: (m: any) => say(`  **signal → the loop**: ${String(m.content).slice(0, 300)}`),
};
const emit = async (ev: string, e: any, c: any) => {
	let r;
	for (const h of on.get(ev) ?? []) r = await h(e, c);
	return r;
};
const gates: string[] = [];
const person = {
	hasUI: true,
	ui: { notify: () => {}, confirm: async (title: string, body: string) => (gates.push(`${title}\n${body}`), say(`  **gate**: ${title} — **the person approves**`), true) },
};

let n = 0;
async function call(tool: string, args: Record<string, unknown>): Promise<string> {
	const id = `s${++n}`;
	say(`→ \`${tool}\` ${JSON.stringify(args)}`);
	const blocked = await emit("tool_call", { toolName: tool, toolCallId: id, input: args }, person);
	if (blocked?.block) {
		say(`  ← BLOCKED: ${blocked.reason}`);
		return `BLOCKED: ${blocked.reason}`;
	}
	try {
		const r = await tools.get(tool).execute(id, args);
		const text = r.content.map((c: any) => c.text).join("\n");
		say(`  ← ${text.slice(0, 900).replace(/\n/g, "\n    ")}`);
		return text;
	} catch (e) {
		say(`  ← ERROR ${(e as Error).message.slice(0, 600)}`);
		return `ERROR ${(e as Error).message}`;
	}
}

const checks: Record<string, boolean> = {};
const check = (what: string, ok: boolean) => {
	checks[what] = ok;
	say(`  ${ok ? "✓" : "✗"} ${what}`);
};

async function main() {
	repl(api);
	domain(api);
	await emit("session_start", {}, person);
	const text = readFileSync(seed, "utf8");
	say(`\n## 1. read the seed\n`);
	await call("repl_state", { arg: "" });
	await call("repl_show", { arg: "base" });
	say(`\n## 2. the seed, as it is, becomes the domain's program\n`);
	const applied = await call("catalog_apply", { domain: name, what: "served", display: `the ${name.replace(/_/g, " ")}`, line: `the program ${basename(seed)}, seeded` });
	const prog = join(cat, "domains", name, `${name}.llp`);
	check("the domain's program is the seed, byte for byte", existsSync(prog) && readFileSync(prog, "utf8") === text);
	check("the gate showed the seed's diff", gates.length === 1 && gates[0].includes(`domains/${name}/${name}.llp (new)`));
	check("the REPL serves the catalog's program", applied.includes(`The REPL now serves ${prog}`));
	check("domain.yaml has the display and line", /^display: /m.test(readFileSync(join(cat, "domains", name, "domain.yaml"), "utf8")));
	say(`\n## 3. intents\n`);
	const it = await call("catalog_apply", { domain: name, what: "intents" });
	const commands = /^pred\s+cmd_\w+/m.test(text);
	if (it.startsWith("no intent.yaml")) check("a world with no commands: no intent.yaml", !commands && !existsSync(join(cat, "domains", name, "intent.yaml")));
	else check("intent.yaml written", it.startsWith("applied:") && existsSync(join(cat, "domains", name, "intent.yaml")));
	if (!commands) say("  (no cmd_* atoms: the person gives this world no commands)");
	say(`\n## 4. exercise\n`);
	const opened = await call("domain_open", { domain: name });
	check("the domain opens", !/^(ERROR|BLOCKED)/.test(opened));
	const clock = await call("domain_clock", { n: 6 });
	check("its clock runs", !/^(ERROR|BLOCKED)/.test(clock));
	await call("domain_state", { domain: name });
	await call("domain_events", { domain: name });
	say(`\n## 5. the person asks for a comment changed: catalog_edit, every other byte kept\n`);
	// the fiction port's case (s-e3d0942d finding 1): one header line, never formalize or revise
	const first = text.split("\n").find((l) => /^% \S/.test(l));
	let expected = text;
	if (first) {
		const ed = await call("catalog_edit", { domain: name, path: `${name}.llp`, old_string: first, new_string: `${first} (edited in the loop)` });
		expected = text.replace(first, `${first} (edited in the loop)`);
		const now = readFileSync(prog, "utf8");
		check("the edit changed that line only", ed.startsWith("applied:") && now === expected);
		const comments = (t: string) => t.split("\n").filter((l) => /^\s*%/.test(l));
		check("every comment is kept", comments(now).length === comments(text).length && comments(now).filter((l) => !comments(text).includes(l)).length === 1);
		check("the REPL serves the edited program", ed.includes(`The REPL now serves ${prog}`));
	} else say("  (the seed has no header comment to edit)");
	say(`\n## 6. a README: the model's title and summary, the rest the SDK's (gated)\n`);
	const rd = await call("catalog_apply", { domain: name, what: "readme", title: `the program ${basename(seed)}`, text: `Seeded from \`${rel}\`.` });
	const readme = readFileSync(join(cat, "domains", name, "README.md"), "utf8");
	check("the README is written, behind the gate", rd.startsWith("applied:") && readme.startsWith(`# ${name} — the program ${basename(seed)}\n\nSeeded from`));
	const head = expected.split("\n").filter((l) => /^%/.test(l));
	check("the README carries the program's header verbatim", !first || readme.includes(head[0]));
	say(`\n## 7. take it into the person's catalog\n`);
	const taken = await call("catalog_take", { domain: name });
	const d = join(into, "domains", name);
	check("taken into the target", taken.startsWith(`taken into ${into}:`));
	check("the target's program is the seed as edited", existsSync(join(d, `${name}.llp`)) && readFileSync(join(d, `${name}.llp`), "utf8") === expected);
	check("the target has domain.yaml and the approved README", existsSync(join(d, "domain.yaml")) && readFileSync(join(d, "README.md"), "utf8") === readme);
	check("its bundle built", existsSync(join(d, "build", `${name}.metis`)));
	check("the loop's own catalog is untouched by the take", !existsSync(join(cat, "domains", name, "build")));
	const again = await call("catalog_take", { domain: name });
	check("a second take is refused", again.startsWith("BLOCKED:") && /already/.test(again));
	const ok = Object.values(checks).every(Boolean);
	say(`\n## end: ${ok ? "every check held" : "a check failed"}; ${gates.length} gates; ${n} calls`);
	writeFileSync(join(dir, "seeded.json"), JSON.stringify({ seed: rel, name, calls: n, gates: gates.length, checks, ok }, null, 1));
	process.exitCode = ok ? 0 : 1;
}

main()
	.catch((e) => {
		say(`FAILED: ${e.stack}`);
		process.exitCode = 1;
	})
	.finally(async () => {
		await emit("session_shutdown", {}, {});
		setTimeout(() => process.exit(), 1500).unref();
	});
