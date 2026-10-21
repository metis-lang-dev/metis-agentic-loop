// A seeded start end to end, scripted (fiction-port s-e3d0942d step 1): the loop's tools
// called in the seeded task's order (prompts/seed-task.md) by this script instead of a
// model, against the real processes — metispy's `metis --json` serving the seed,
// metis-agent's domain agent, the loop SDK's catalog — and taken into a second catalog.
// No model: a seeded start formalizes nothing, so the run costs nothing.
//
//   node/bin/node --experimental-strip-types example/seeded.ts SEED.llp|PKG_DIR DIR [NAME]
//
// PKG_DIR, a domain package (rddl-worlds s-242c7c3f: domains/nav/), is a package seed as
// loop.sh --seed PKG_DIR makes it: the package whole, its program, included files and host;
// a world with a host of its own is also measured (domain_ports, domain_episodes).
//
// DIR is the catalog, made empty (DIR and DIR.into are removed first: give a scratch path), and the script runs in it, as `cd DIR && loop.sh --seed SEED`
// (cwd-root s-ddac2cbf): the seed copied into DIR/.metis/seed/ with DIR/.metis/seed.json, the
// records in DIR/.metis/records/; the target catalog is DIR.into beside it (empty); DIR/.metis/
// also gets seeded.md (the calls and their answers) and seeded.json (what held). Exit 1 when any
// check fails.
import { appendFileSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import repl from "../extensions/metis-repl.ts";
import domain from "../extensions/metis-domain.ts";
import * as catalog from "../extensions/sdk/catalog.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const PKGS = join(HERE, "..", "..");                              // the workspace (its .venv, metis-agent: defaults)
const AGENT = process.env.METIS_AGENT ?? join(PKGS, "metis-agent");
const seed = resolve(process.argv[2] ?? "");
const dir = resolve(process.argv[3] ?? "/tmp/loop-seeded");
if (!existsSync(seed)) throw new Error(`usage: seeded.ts SEED.llp|PKG_DIR DIR [NAME] (no seed at ${seed})`);
const pkg = statSync(seed).isDirectory();
const name = process.argv[4] ?? basename(seed, ".llp").replace(/-/g, "_");
const SKIP = /\/(build|records|__pycache__)(\/|$)/;

// the run, as `cd DIR && loop.sh --seed SEED --name NAME` lays it out
const cat = dir, into = `${dir}.into`;
for (const c of [cat, into]) {
	rmSync(c, { recursive: true, force: true });
	mkdirSync(c, { recursive: true });
}
const st = catalog.state(cat);                                     // DIR/.metis/: the loop's state
mkdirSync(join(st, "seed"));
mkdirSync(join(st, "records"));
const at = seed.indexOf("/domains/");                             // catalog-relative inside a catalog (loop.sh's rule)
const rel = at >= 0 ? seed.slice(at + 1) : seed;
if (pkg) {
	cpSync(seed, join(st, "seed", "domains", name), { recursive: true, filter: (f) => !SKIP.test(f) });
	writeFileSync(join(st, "seed.json"), JSON.stringify({ seed: rel, name, package: true }));
} else {
	cpSync(seed, join(st, "seed", `${name}.llp`));
	writeFileSync(join(st, "seed.json"), JSON.stringify({ seed: rel, name }));
}
process.chdir(cat);
// an RDDL host imports tools/rddl_host.py: the installed metis-catalog's, as loop.sh puts it on PYTHONPATH
const rddlTools = catalog.installed().tools;
Object.assign(process.env, {
	METIS_CATALOG: cat,
	METIS_LOOP_TAKE_INTO: into,
	METIS_LOOP_RUN: st,
	PYTHONPATH: [rddlTools, process.env.PYTHONPATH].filter(Boolean).join(":"),
	METIS_LOOP_RECORDS: join(st, "records"),
	METIS_LOOP_LLP: join(st, "seed", `${name}.llp`),
	METIS_RDDL_PY: process.env.METIS_RDDL_PY ?? join(PKGS, ".venv", "bin", "python"), // a DIR has no .venv beside it
	METIS_LOOP_METIS: process.env.METIS_LOOP_METIS ?? join(PKGS, ".venv", "bin", "metis"),
	METIS_LOOP_SDK_PY: process.env.METIS_LOOP_SDK_PY ?? join(PKGS, ".venv", "bin", "python"),
	METIS_LOOP_AGENT_PY: process.env.METIS_LOOP_AGENT_PY ?? join(AGENT, "py", ".venv", "bin", "python"),
	METIS_LOOP_AGENT_DIR: process.env.METIS_LOOP_AGENT_DIR ?? join(AGENT, "py"),
});

// a package's files (relative to it), and its program where the seed catalog serves it
const files = (root: string, at = ""): string[] =>
	readdirSync(join(root, at), { withFileTypes: true }).flatMap((e) =>
		SKIP.test(`/${at}/${e.name}/`) ? [] : e.isDirectory() ? files(root, join(at, e.name)) : [join(at, e.name)]);
if (pkg) process.env.METIS_LOOP_LLP = catalog.get(name, join(st, "seed")).program;
const seedProg = process.env.METIS_LOOP_LLP!;
const progName = basename(seedProg);
const log = join(st, "seeded.md");
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
	const text = readFileSync(seedProg, "utf8");
	say(`\n## 1. read the seed\n`);
	await call("repl_state", { arg: "" });
	await call("repl_show", { arg: "base" });
	say(`\n## 2. the seed, as it is, becomes the domain's program\n`);
	const applied = await call("catalog_apply", { domain: name, what: "served", display: `the ${name.replace(/_/g, " ")}`, line: `the program ${basename(seed)}, seeded` });
	const prog = join(cat, "domains", name, progName);
	check("the domain's program is the seed, byte for byte", existsSync(prog) && readFileSync(prog, "utf8") === text);
	check("the gate showed the seed's diff", gates.length === 1 && gates[0].includes(`domains/${name}/${progName} (new)`));
	check("the REPL serves the catalog's program", applied.includes(`The REPL now serves ${prog}`));
	check("domain.yaml has the display and line", /^display: /m.test(readFileSync(join(cat, "domains", name, "domain.yaml"), "utf8")));
	if (pkg) {
		const own = files(seed);
		check("the package came whole, every file byte for byte", own.every((f) =>
			existsSync(join(cat, "domains", name, f)) && readFileSync(join(cat, "domains", name, f), "utf8") === readFileSync(join(seed, f), "utf8")));
		check("the gate showed every file of it", own.every((f) => gates[0].includes(`domains/${name}/${f} (new)`)));
	}
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
	const ports = await call("domain_ports", {});
	if (/^gym: /.test(ports)) {
		// a world with a host of its own (an RDDL gym): measured, and recorded — nothing fixed
		const a = await call("domain_episodes", { n: 3, seed: 1 });
		const b = await call("domain_episodes", { n: 3, seed: 1 });
		check("its episodes are measured, the likelihood per action", /^3 episode\(s\), seeds 1–3;/.test(a) && /P\(the world's answer \| the action the program sent\)/.test(a));
		check("the same seeds measure the same", a === b);
	}
	say(`\n## 5. the person asks for a comment changed: catalog_edit, every other byte kept\n`);
	// the fiction port's case (s-e3d0942d finding 1): one header line, never formalize or revise
	const first = text.split("\n").find((l) => /^% \S/.test(l));
	let expected = text;
	if (first) {
		const ed = await call("catalog_edit", { domain: name, path: progName, old_string: first, new_string: `${first} (edited in the loop)` });
		expected = text.replace(first, `${first} (edited in the loop)`);
		const now = readFileSync(prog, "utf8");
		check("the edit changed that line only", ed.startsWith("applied:") && now === expected);
		const comments = (t: string) => t.split("\n").filter((l) => /^\s*%/.test(l));
		check("every comment is kept", comments(now).length === comments(text).length && comments(now).filter((l) => !comments(text).includes(l)).length === 1);
		check("the REPL serves the edited program", ed.includes(`The REPL now serves ${prog}`));
	} else say("  (the seed has no header comment to edit)");
	let readme: string;
	if (pkg && existsSync(join(seed, "README.md"))) {
		say(`\n## 6. the package's own README, kept\n`);
		readme = readFileSync(join(cat, "domains", name, "README.md"), "utf8");
		check("the package's README is kept", readme === readFileSync(join(seed, "README.md"), "utf8"));
	} else {
		say(`\n## 6. a README: the model's title and summary, the rest the SDK's (gated)\n`);
		const rd = await call("catalog_apply", { domain: name, what: "readme", title: `the program ${basename(seed)}`, text: `Seeded from \`${rel}\`.` });
		readme = readFileSync(join(cat, "domains", name, "README.md"), "utf8");
		check("the README is written, behind the gate", rd.startsWith("applied:") && readme.startsWith(`# ${name} — the program ${basename(seed)}\n\nSeeded from`));
		const head = expected.split("\n").filter((l) => /^%/.test(l));
		check("the README carries the program's header verbatim", !first || readme.includes(head[0]));
	}
	say(`\n## 7. take it into the person's catalog\n`);
	const taken = await call("catalog_take", { domain: name });
	const d = join(into, "domains", name);
	check("taken into the target", taken.startsWith(`taken into ${into}:`));
	check("the target's program is the seed as edited", existsSync(join(d, progName)) && readFileSync(join(d, progName), "utf8") === expected);
	if (pkg)
		check("the target has every other file of the package", files(seed).filter((f) => f !== progName).every((f) =>
			existsSync(join(d, f)) && readFileSync(join(d, f), "utf8") === readFileSync(join(seed, f), "utf8")));
	check("the target has domain.yaml and the approved README", existsSync(join(d, "domain.yaml")) && readFileSync(join(d, "README.md"), "utf8") === readme);
	check("its bundle built", existsSync(join(d, "build", `${name}.metis`)));
	check("the loop's own catalog is untouched by the take", !existsSync(join(cat, "domains", name, "build")));
	const again = await call("catalog_take", { domain: name });
	check("a second take is refused", again.startsWith("BLOCKED:") && /already/.test(again));
	const ok = Object.values(checks).every(Boolean);
	say(`\n## end: ${ok ? "every check held" : "a check failed"}; ${gates.length} gates; ${n} calls`);
	writeFileSync(join(st, "seeded.json"), JSON.stringify({ seed: rel, name, calls: n, gates: gates.length, checks, ok }, null, 1));
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
