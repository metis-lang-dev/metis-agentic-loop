// The two extensions against stand-ins (no model, no pi session): the tools are
// generated from the interfaces' declarations, the apply gate holds (no person,
// a refusal, an ungated candidate) and writes only what the person approved,
// and a domain's surprise enters the loop as a steered message.
//   node/bin/node --experimental-strip-types --test test/extensions.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import repl from "../extensions/metis-repl.ts";
import domain from "../extensions/metis-domain.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
// the workspace (metis-agentic-loop beside metispy's venv and metis-agent: defaults only);
// CI points these at its own installs
const PKGS = join(HERE, "..", "..");
const AGENT = join(PKGS, "metis-agent");
// the fixtures' catalog (the plant, nav, love_triangle): $TEST_CATALOG, else the installed
// metis-catalog's own (the loop SDK's catalog.installed(): never a checkout beside this one)
const CATALOG = process.env.TEST_CATALOG ?? JSON.parse(spawnSync(process.env.TEST_SDK_PY ?? join(PKGS, ".venv", "bin", "python"),
	["-m", "metis_loop_sdk.catalog", "installed", "--json"], { encoding: "utf8" }).stdout).catalog;

function fakePi() {
	const tools = new Map<string, any>();
	const on = new Map<string, ((e: any, c: any) => any)[]>();
	const messages: { msg: any; opts: any }[] = [];
	return {
		tools,
		messages,
		emit: async (ev: string, e: any, c: any) => {
			let r;
			for (const h of on.get(ev) ?? []) r = await h(e, c);
			return r;
		},
		api: {
			registerTool: (t: any) => tools.set(t.name, t),
			registerCommand: () => {},
			on: (ev: string, h: any) => on.set(ev, [...(on.get(ev) ?? []), h]),
			sendMessage: (msg: any, opts: any) => messages.push({ msg, opts }),
		} as any,
	};
}

function env(gated: boolean) {
	const cat = mkdtempSync(join(tmpdir(), "loop-cat-"));
	mkdirSync(join(cat, "domains", "lamp"), { recursive: true });
	writeFileSync(join(cat, "domains", "lamp", "lamp_host.py"), "# the world\n");
	Object.assign(process.env, {
		METIS_CATALOG: cat,
		METIS_LOOP_METIS: join(HERE, "stub", "metis"),
		METIS_LOOP_SDK_PY: process.env.TEST_SDK_PY ?? join(PKGS, ".venv", "bin", "python"), // the loop SDK's catalog CLI
		REAL_METIS: process.env.REAL_METIS ?? join(PKGS, ".venv", "bin", "metis"),
		STUB_LOG: join(cat, "stub.log"),
		STUB_GATED: gated ? "1" : "0",
		METIS_LOOP_LLP: "",
	});
	return cat;
}

const ui = (answer: boolean) => ({ hasUI: true, ui: { confirm: async () => answer, notify: () => {} } });

test("metis-repl: the wire's verbs become tools, its words or the finding's marker", async () => {
	env(true);
	const p = fakePi();
	repl(p.api);
	await p.emit("session_start", {}, ui(true));
	try {
		assert.deepEqual([...p.tools.keys()].sort(),
			["catalog_apply", "catalog_edit", "catalog_take", "repl_formalize", "repl_gate", "repl_show", "repl_state", "repl_text"]);
		assert.match(p.tools.get("repl_state").description, /the domain's current state/);
		assert.match(p.tools.get("repl_text").description, /finding: metispy/);
		const r = await p.tools.get("repl_text").execute("c1", { arg: "a desk lamp" });
		assert.equal(r.content[0].text, "text a desk lamp");
	} finally {
		await p.emit("session_shutdown", {}, {}); // a failed assert must not leave the REPL child holding the run open
	}
});

test("metis-repl: the apply gate — no person, a refusal, an ungated candidate block; an approval writes and reopens", async () => {
	const cat = env(true);
	const p = fakePi();
	repl(p.api);
	await p.emit("session_start", {}, ui(true));
	const call = (id: string) => ({ toolName: "catalog_apply", toolCallId: id, input: { domain: "lamp", what: "program" } });
	assert.match((await p.emit("tool_call", call("a"), { hasUI: false, ui: {} })).reason, /no person/);
	assert.match((await p.emit("tool_call", call("b"), ui(false))).reason, /did not approve/);
	await assert.rejects(p.tools.get("catalog_apply").execute("b", { domain: "lamp", what: "program" }), /not approved/);
	assert.ok(!existsSync(join(cat, "domains", "lamp", "lamp.llp")));
	assert.equal(await p.emit("tool_call", call("c"), ui(true)), undefined);
	const r = await p.tools.get("catalog_apply").execute("c", { domain: "lamp", what: "program" });
	assert.match(r.content[0].text, /applied: .*lamp\.llp.*domain\.yaml.*serves .*lamp\.llp with its host/);
	assert.match(readFileSync(join(cat, "domains", "lamp", "lamp.llp"), "utf8"), /^catalog lamp 1\./);
	assert.match(readFileSync(join(cat, "domains", "lamp", "domain.yaml"), "utf8"), /program: lamp\.llp\nhost: lamp_host\.py:make\n/);
	const argv = readFileSync(join(cat, "stub.log"), "utf8").trim().split("\n").map((l) => JSON.parse(l)).filter((l) => l.argv).map((l) => l.argv);
	assert.deepEqual(argv.at(-1).slice(0, 2), ["--json", "--host"]);   // reopened on the program, with its host
	await p.emit("session_shutdown", {}, {});
	env(false);
	const q = fakePi();
	repl(q.api);
	await q.emit("session_start", {}, ui(true));
	assert.match((await q.emit("tool_call", call("d"), ui(true))).reason, /not passed the gate/);
	await q.emit("session_shutdown", {}, {});
});

test("metis-repl: a written program metis cannot load leaves the REPL that was serving, and says so", async () => {
	const cat = env(true);
	const p = fakePi();
	repl(p.api);
	await p.emit("session_start", {}, ui(true));
	process.env.STUB_UNLOADABLE = "1";
	try {
		const call = { toolName: "catalog_apply", toolCallId: "u", input: { domain: "lamp", what: "program" } };
		assert.equal(await p.emit("tool_call", call, ui(true)), undefined);
		const r = await p.tools.get("catalog_apply").execute("u", { domain: "lamp", what: "program" });
		assert.match(r.content[0].text, /applied: .*lamp\.llp.*metis cannot load the program it wrote: .*invalid literal.*still serves what it served before/);
		assert.ok(existsSync(join(cat, "domains", "lamp", "lamp.llp")));   // the write stands: the catalog is the person's
		const s = await p.tools.get("repl_state").execute("s", { arg: "" });   // the old REPL answers
		assert.equal(s.content[0].text, "state");
	} finally {
		delete process.env.STUB_UNLOADABLE;
		await p.emit("session_shutdown", {}, {});
	}
});

test("metis-repl: catalog_apply through the loop SDK — the gate shows its dry-run diff; an extension, then intents drafted and generated", async () => {
	const cat = env(true);
	// no tools/ here: the intent generator is the installed metis-catalog's (the SDK's fallback)
	const d = join(cat, "domains", "lamp");
	writeFileSync(join(d, "lamp.llp"), "catalog lamp 1.\npred cmd_switch_on : lamp.\n");
	writeFileSync(join(d, "domain.yaml"), "program: lamp.llp\n");
	const p = fakePi();
	repl(p.api);
	await p.emit("session_start", {}, ui(true));
	const shown: string[] = [];
	const watch = { hasUI: true, ui: { confirm: async (t: string, b: string) => (shown.push(`${t}\n${b}`), true), notify: () => {} } };
	const ext = { toolName: "catalog_apply", toolCallId: "e", input: { domain: "lamp", what: "extension", name: "dimmer" } };
	assert.equal(await p.emit("tool_call", ext, watch), undefined);
	assert.match(shown[0], /domains\/lamp\/extensions\/dimmer\.llp \(new\)[\s\S]*\+\+\+ b\/domains\/lamp\/extensions\/dimmer\.llp[\s\S]*\+catalog lamp 1\./);
	assert.ok(!existsSync(join(d, "extensions", "dimmer.llp")));                   // the dry run wrote nothing
	const e = await p.tools.get("catalog_apply").execute("e", ext.input);
	assert.match(e.content[0].text, /applied: domains\/lamp\/extensions\/dimmer\.llp\./);
	assert.match(readFileSync(join(d, "extensions", "dimmer.llp"), "utf8"), /^catalog lamp 1\./);
	const it = { toolName: "catalog_apply", toolCallId: "i", input: { domain: "lamp", what: "intents" } };
	assert.equal(await p.emit("tool_call", it, watch), undefined);
	assert.match(shown[1], /domains\/lamp\/intent\.yaml \(new\)[\s\S]*SWITCH_ON/);
	const i = await p.tools.get("catalog_apply").execute("i", it.input);
	assert.deepEqual([...i.details.written].sort(), ["domains/lamp/domain.yaml", "domains/lamp/intent.yaml",   // no -spoken.txt: it is empty
		"domains/lamp/intent/lamp-prompt.txt", "domains/lamp/intent/lamp.gbnf"]);
	assert.match(readFileSync(join(d, "domain.yaml"), "utf8"), /^program: lamp\.llp\nintent: \{spec: intent\.yaml\}\n$/);
	assert.match(readFileSync(join(d, "intent", "lamp.gbnf"), "utf8"), /SWITCH_ON/);
	// the SDK's refusal reaches the person's gate as the reason
	const bad = { toolName: "catalog_apply", toolCallId: "x", input: { domain: "nosuch", what: "intents" } };
	assert.match((await p.emit("tool_call", bad, watch)).reason, /catalog intents: .*nosuch/);
	await p.emit("session_shutdown", {}, {});
});

test("metis-repl: catalog_take takes a domain into the person's catalog, behind the gate, with a README", async () => {
	const cat = env(true);
	const d = join(cat, "domains", "lamp");
	writeFileSync(join(d, "lamp.llp"), 'catalog lamp 1.\nprovenance text "A desk lamp. It starts dark." "2026-10-18".\npred dark : lamp.\n');
	writeFileSync(join(d, "domain.yaml"), "program: lamp.llp\nhost: lamp_host.py:make\n");
	mkdirSync(join(d, "extensions"));
	writeFileSync(join(d, "extensions", "wear.llp"), "catalog lamp_wear 1.\nextends lamp.\n");
	const into = mkdtempSync(join(tmpdir(), "loop-into-"));
	mkdirSync(join(into, "domains"));
	const p = fakePi();
	repl(p.api);
	await p.emit("session_start", {}, ui(true));
	try {
		const take = { toolName: "catalog_take", toolCallId: "t", input: { domain: "lamp" } };
		delete process.env.METIS_LOOP_TAKE_INTO;
		assert.match((await p.emit("tool_call", take, ui(true))).reason, /no catalog to take the domain into: start the loop with --into DIR2 \(or METIS_LOOP_TAKE_INTO=DIR2\)/);
		process.env.METIS_LOOP_TAKE_INTO = cat;
		assert.match((await p.emit("tool_call", take, ui(true))).reason, /the catalog the loop writes/);
		process.env.METIS_LOOP_TAKE_INTO = into;
		assert.equal((await p.emit("tool_call", take, ui(false))).reason, "the person did not approve this write");
		const shown: string[] = [];
		const watch = { hasUI: true, ui: { confirm: async (t: string, b: string) => (shown.push(`${t}\n${b}`), true), notify: () => {} } };
		assert.equal(await p.emit("tool_call", take, watch), undefined);
		assert.ok(shown[0].startsWith(`Take into the catalog ${into}: `));
		assert.match(shown[0], /domains\/lamp\/README\.md \(new\)[\s\S]*\+# lamp — a desk lamp/);
		assert.ok(!existsSync(join(into, "domains", "lamp")));                         // the dry run wrote nothing
		await assert.rejects(p.tools.get("catalog_apply").execute("t", { domain: "lamp", what: "program" }), /not approved/);
		assert.equal(await p.emit("tool_call", take, watch), undefined);                  // (the plan apply refused is gone)
		const t = await p.tools.get("catalog_take").execute("t", take.input);
		assert.match(t.content[0].text, new RegExp(`^taken into ${into}: .*domains/lamp/lamp_host\\.py`));
		for (const f of ["lamp.llp", "lamp_host.py", "domain.yaml", "extensions/wear.llp"])
			assert.equal(readFileSync(join(into, "domains", "lamp", f), "utf8"), readFileSync(join(d, f), "utf8"), f);
		assert.match(readFileSync(join(into, "domains", "lamp", "README.md"), "utf8"), /`extensions\/wear\.llp`/);
		assert.match((await p.emit("tool_call", take, watch)).reason, /has domains\/lamp already/);
	} finally {
		delete process.env.METIS_LOOP_TAKE_INTO;
		await p.emit("session_shutdown", {}, {}); // a failed assert must not leave the REPL child holding the run open
	}
});

test("metis-repl: what=served writes the program the REPL serves, as it is (a seed); a blank world has none", async () => {
	const cat = env(true);
	let p = fakePi();
	repl(p.api);
	await p.emit("session_start", {}, ui(true));
	const served = { toolName: "catalog_apply", toolCallId: "v", input: { domain: "story", what: "served" } };
	try {
		assert.match((await p.emit("tool_call", served, ui(true))).reason, /blank world/);
	} finally {
		await p.emit("session_shutdown", {}, {});
	}
	const seed = join(mkdtempSync(join(tmpdir(), "loop-seed-")), "story.llp");
	const text = "% a seed: its header\ncatalog story 1.\npred a : story.\n#init a 1\n";
	writeFileSync(seed, text);
	process.env.METIS_LOOP_LLP = seed;
	p = fakePi();
	repl(p.api);
	await p.emit("session_start", {}, ui(true));
	try {
		const shown: string[] = [];
		const watch = { hasUI: true, ui: { confirm: async (t: string, b: string) => (shown.push(`${t}\n${b}`), true), notify: () => {} } };
		assert.equal(await p.emit("tool_call", served, watch), undefined);
		assert.match(shown[0], /domains\/story\/story\.llp \(new\), domains\/story\/domain\.yaml \(new\)\?[\s\S]*\+% a seed: its header/);
		const r = await p.tools.get("catalog_apply").execute("v", served.input);
		assert.match(r.content[0].text, /^applied: domains\/story\/story\.llp, domains\/story\/domain\.yaml\./);
		assert.equal(readFileSync(join(cat, "domains", "story", "story.llp"), "utf8"), text);   // byte for byte
		assert.doesNotMatch(readFileSync(process.env.STUB_LOG!, "utf8"), /"op": "show"/);       // no candidate asked for
		// what=readme: a gated README for a known domain, the model's title and summary, the rest the SDK's
		const rd = { toolName: "catalog_apply", toolCallId: "m", input: { domain: "story", what: "readme", title: "a seed", text: "From its header." } };
		assert.equal(await p.emit("tool_call", rd, watch), undefined);
		assert.match(shown[1], /domains\/story\/README\.md \(new\)[\s\S]*\+# story — a seed\n\+\n\+From its header\.\n/);
		await p.tools.get("catalog_apply").execute("m", rd.input);
		const readme = readFileSync(join(cat, "domains", "story", "README.md"), "utf8");
		assert.ok(readme.startsWith("# story — a seed\n\nFrom its header.\n\n**Where it came from:**"));
		assert.match(readme, /```text\n% a seed: its header\n```/);                              // the header, verbatim
		assert.match(readme, /`metisc --run story\.llp` runs the case its `#` lines give:\n\n```text\n#init a 1\n```/);
		assert.match((await p.emit("tool_call", { ...rd, input: { domain: "story", what: "readme" } }, watch)).reason, /text is the summary paragraph/);
		assert.match((await p.emit("tool_call", { ...rd, input: { domain: "nosuch", what: "readme", text: "x" } }, watch)).reason, /its README follows its program/);
	} finally {
		process.env.METIS_LOOP_LLP = "";
		await p.emit("session_shutdown", {}, {});
	}
});

test("metis-repl: a seeded run applies the seed first — what=program/extension for a domain not yet in its catalog are refused (review R2)", async () => {
	const cat = env(true);                                                               // STUB_GATED: a gated candidate
	process.env.METIS_LOOP_RUN = mkdtempSync(join(tmpdir(), "loop-seeded-run-"));
	writeFileSync(join(process.env.METIS_LOOP_RUN, "seed.json"), JSON.stringify({ seed: "x.llp", name: "lamp" }));
	const p = fakePi();
	repl(p.api);
	await p.emit("session_start", {}, ui(true));
	try {
		for (const input of [{ domain: "lamp", what: "program" }, { domain: "other", what: "program" }, { domain: "lamp", what: "extension", name: "x" }]) {
			const r = await p.emit("tool_call", { toolName: "catalog_apply", toolCallId: "q", input }, ui(true));
			assert.match(r.reason, new RegExp(`a seeded run applies the seed first \\(catalog_apply domain=${input.domain} what=served\\)`));
		}
		// the seed is applied under its own name only: another would leave it pending in this DIR for good (review F2)
		const other = await p.emit("tool_call", { toolName: "catalog_apply", toolCallId: "q", input: { domain: "other", what: "served" } }, ui(true));
		assert.match(other.reason, /the seed is lamp: catalog_apply domain=lamp what=served/);
		// once the domain is in the catalog (the seed applied), a change is its diff
		writeFileSync(join(cat, "domains", "lamp", "lamp.llp"), "catalog lamp 1.\n");
		writeFileSync(join(cat, "domains", "lamp", "domain.yaml"), "program: lamp.llp\n");
		const shown: string[] = [];
		const watch = { hasUI: true, ui: { confirm: async (t: string, b: string) => (shown.push(`${t}\n${b}`), true), notify: () => {} } };
		assert.equal(await p.emit("tool_call", { toolName: "catalog_apply", toolCallId: "q", input: { domain: "lamp", what: "program" } }, watch), undefined);
		assert.match(shown[0], /domains\/lamp\/lamp\.llp\?[\s\S]*--- a\/domains\/lamp\/lamp\.llp[\s\S]*\+% the stub's candidate/);   // not (new): a diff
		// the seed applied, the DIR is a catalog like any (cwd-root): a new domain's program as in an unseeded run
		const r = await p.emit("tool_call", { toolName: "catalog_apply", toolCallId: "u", input: { domain: "other", what: "program" } }, watch);
		assert.equal(r, undefined);
		assert.match(shown[1], /domains\/other\/other\.llp \(new\)/);
	} finally {
		delete process.env.METIS_LOOP_RUN;
		await p.emit("session_shutdown", {}, {});
	}
});

// cwd-root s-ddac2cbf: loop.sh runs in the directory it starts in — DIR is the catalog, its state in DIR/.metis/
function loopIn(dir: string, args: string[], extra: Record<string, string> = {}) {
	const e: Record<string, string | undefined> = { ...process.env, METIS_LOOP_PI: join(HERE, "stub", "pi"), MODEL: "ollama/metis-gemma4-e4b-cpu", METIS_CONFIG: "",
		METIS_LOOP_SDK_PY: process.env.TEST_SDK_PY ?? join(PKGS, ".venv", "bin", "python"), METIS_LOOP_TAKE_INTO: "", METIS_LOOP_LLP: "" };
	delete e.METIS_CATALOG;                                                              // the cwd is the catalog, unless `extra` names one
	Object.assign(e, extra);
	const r = spawnSync(join(HERE, "..", "loop.sh"), args, { encoding: "utf8", cwd: dir, env: e as any });
	return { code: r.status, out: r.stdout ? JSON.parse(r.stdout) : null, err: r.stderr };
}

test("loop.sh: the directory it starts in is the catalog and pi's cwd; its state in DIR/.metis/; --scratch is gone; take only into a named catalog", () => {
	const dir = mkdtempSync(join(tmpdir(), "loop-cwd-"));
	const a = loopIn(dir, []);
	assert.equal(a.code, 0, a.err);
	assert.equal(a.out.cwd, dir);
	assert.equal(a.out.env.METIS_CATALOG, dir);
	assert.equal(a.out.env.METIS_LOOP_RUN, join(dir, ".metis"));
	assert.equal(a.out.env.METIS_LOOP_RECORDS, join(dir, ".metis", "records"));
	assert.equal(a.out.env.PI_LOOP_SESSIONS, join(dir, ".metis", "sessions"));
	assert.equal(a.out.env.METIS_LOOP_TAKE_INTO, "");                                    // none named: catalog_take refuses
	assert.deepEqual(readdirSync(dir), [".metis"]);                                      // nothing laid out: an empty catalog
	assert.ok(!existsSync(join(dir, ".gitignore")));                                     // not a checkout
	const git = mkdtempSync(join(tmpdir(), "loop-cwd-git-"));
	mkdirSync(join(git, ".git"));
	assert.equal(loopIn(git, []).code, 0);
	assert.match(readFileSync(join(git, ".gitignore"), "utf8"), /^\/\.metis\/$/m);       // a checkout ignores the loop's state
	const other = mkdtempSync(join(tmpdir(), "loop-cwd-into-"));
	assert.equal(loopIn(dir, ["--into", other]).out.env.METIS_LOOP_TAKE_INTO, other);
	assert.equal(loopIn(dir, [], { METIS_LOOP_TAKE_INTO: other }).out.env.METIS_LOOP_TAKE_INTO, other);
	assert.match(loopIn(dir, ["--into", dir]).err, /is the catalog the loop runs in/);
	assert.match(loopIn(dir, ["--into", join(dir, "nope")]).err, /--into .*: no such directory/);
	const away = loopIn(tmpdir(), [], { METIS_CATALOG: dir });                           // METIS_CATALOG: started elsewhere
	assert.equal(away.out.cwd, dir);
	assert.equal(away.out.env.METIS_CATALOG, dir);
	assert.match(loopIn(dir, ["--scratch", dir]).err, /--scratch is gone: cd DIR && loop\.sh/);
	assert.match(loopIn(dir, ["--seed", "x.llp", "--scratch", dir]).err, /--scratch is gone/);          // anywhere in the args (review N1)
});

test("loop.sh --seed: the seed, its name, the task as pi's first message; a DIR is seeded once", () => {
	const run = (dir: string, ...args: string[]) => loopIn(dir, args);
	const src = mkdtempSync(join(tmpdir(), "loop-seedsrc-#&-"));                      // the task's fill takes any path
	writeFileSync(join(src, "love-story.llp"), "catalog love-story 1.\n");
	writeFileSync(join(src, "3lp.llp"), "catalog three-pigs 1.\n");
	const dir = mkdtempSync(join(tmpdir(), "loop-seeded-"));
	const st = join(dir, ".metis");
	const a = run(dir, "--seed", join(src, "love-story.llp"));
	assert.equal(a.code, 0, a.err);
	assert.equal(a.out.env.METIS_LOOP_LLP, join(st, "seed", "love_story.llp"));      // the stem, - as _
	assert.equal(readFileSync(join(st, "seed", "love_story.llp"), "utf8"), "catalog love-story 1.\n");
	assert.deepEqual(JSON.parse(readFileSync(join(st, "seed.json"), "utf8")), { seed: join(src, "love-story.llp"), name: "love_story" });
	assert.equal(a.out.env.METIS_LOOP_RUN, st);
	assert.equal(a.out.env.METIS_CATALOG, dir);
	assert.ok(!existsSync(join(dir, "domains")));                                       // the seed is the model's to apply
	const task = a.out.args[a.out.args.length - 1];
	// the exact path (it holds # and &: bash's patsub_replacement must not expand the &)
	assert.ok(task.includes("The REPL serves an existing program, the seed: `" + join(src, "love-story.llp") + "`. Make it the catalog domain `love_story`"), task.slice(0, 300));
	assert.match(task, /`catalog_apply` with domain=love_story what=served/);
	assert.match(task, /`domain_episodes` with seed=1 and n=20: the person's n/);         // the default n, in the task itself
	assert.ok(!task.includes("{{"), "every placeholder is filled");
	assert.equal(readFileSync(join(st, "seed", "task.md"), "utf8").trim(), task.trim());
	assert.equal(run(dir, "--seed", join(src, "love-story.llp")).code, 0);              // the same seed again: the same run
	assert.match(run(dir, "--seed", join(src, "3lp.llp"), "--name", "pigs").err, /seeded otherwise/);
	const plain = run(dir);                                                              // a seeded DIR is a catalog: a plain start works in it
	assert.equal(plain.code, 0, plain.err);
	assert.equal(plain.out.env.METIS_LOOP_LLP, "");
	const rpc = run(dir, "--seed", join(src, "love-story.llp"), "--mode", "rpc");
	assert.equal(rpc.out.args[rpc.out.args.length - 1], "rpc");                        // a client sends the task itself
	const d2 = mkdtempSync(join(tmpdir(), "loop-seeded-"));
	assert.match(run(d2, "--seed", join(src, "3lp.llp")).err, /'3lp': lowercase letters, digits, _ \(give --name NAME\)/);
	assert.equal(run(d2, "--seed", join(src, "3lp.llp"), "--name", "three_pigs").out.env.METIS_LOOP_LLP, join(d2, ".metis", "seed", "three_pigs.llp"));
	assert.match(run(mkdtempSync(join(tmpdir(), "loop-seeded-")), "--name", "x").err, /--name and --episodes go with --seed/);
	assert.match(run(mkdtempSync(join(tmpdir(), "loop-seeded-")), "--episodes", "5").err, /--name and --episodes go with --seed/);
	// rddl-watch s-cfe94dca: the person's n is in the task from its first message (step 3's finding 9: the model ran
	// n=20 before a steer with n=5 arrived); a bad n is refused before anything is made
	const d5 = mkdtempSync(join(tmpdir(), "loop-seeded-"));
	assert.match(run(d5, "--seed", join(src, "3lp.llp"), "--name", "pigs", "--episodes", "0").err, /--episodes 0: 1-50/);
	assert.ok(!existsSync(join(d5, ".metis")));
	const e5 = run(d5, "--seed", join(src, "3lp.llp"), "--name", "pigs", "--episodes", "5");
	assert.equal(e5.code, 0, e5.err);
	assert.match(e5.out.args[e5.out.args.length - 1], /`domain_episodes` with seed=1 and n=5: the person's n, set before this task began/);
	// a DIR that has the domain already is not seeded over it
	const has = mkdtempSync(join(tmpdir(), "loop-seeded-has-"));
	mkdirSync(join(has, "domains", "pigs"), { recursive: true });
	writeFileSync(join(has, "domains", "pigs", "domain.yaml"), "program: pigs.llp\n");
	writeFileSync(join(has, "domains", "pigs", "pigs.llp"), "catalog pigs 1.\n");
	assert.match(run(has, "--seed", join(src, "3lp.llp"), "--name", "pigs").err, /has a domain pigs already: --name another/);
	// a seed inside a catalog is named catalog-relative (the README's "seeded from")
	const inCat = join(mkdtempSync(join(tmpdir(), "loop-seedcat-")), "domains", "tale");
	mkdirSync(inCat, { recursive: true });
	writeFileSync(join(inCat, "tale.llp"), "catalog tale 1.\n");
	const d6 = mkdtempSync(join(tmpdir(), "loop-seeded-"));
	assert.equal(run(d6, "--seed", join(inCat, "tale.llp")).code, 0);
	assert.equal(JSON.parse(readFileSync(join(d6, ".metis", "seed.json"), "utf8")).seed, "domains/tale/tale.llp");
});

// the seeded start end to end with the real processes (example/seeded.ts): metis, the domain
// agent and the loop SDK, into a scratch target; skipped where metis-agent is not installed
const AGENT_PY = process.env.TEST_AGENT_PY ?? join(AGENT, "py", ".venv", "bin", "python");
const hasAgent = spawnSync(AGENT_PY, ["-c", "import metis_agent.intent_domain"], { cwd: join(AGENT, "py") }).status === 0;
if (!hasAgent && process.env.TEST_REQUIRE_AGENT) throw new Error(`TEST_REQUIRE_AGENT: ${AGENT_PY} cannot import metis_agent beside ${AGENT}`);
test("example/seeded.ts: a fiction program seeded, applied as it is, opened, run and taken", { skip: !hasAgent && "no metis-agent" }, () => {
	const dir = mkdtempSync(join(tmpdir(), "loop-seeded-e2e-"));
	const r = spawnSync(join(PKGS, "metis-agentic-loop", "node", "bin", "node"),
		["--experimental-strip-types", "--no-warnings", join(HERE, "..", "example", "seeded.ts"),
			join(CATALOG, "domains", "ceptre", "love_triangle", "love_triangle.llp"), dir], {
		encoding: "utf8", timeout: 240000,
		env: { ...process.env, METIS_LOOP_METIS: process.env.REAL_METIS ?? join(PKGS, ".venv", "bin", "metis"),
			METIS_LOOP_SDK_PY: process.env.TEST_SDK_PY ?? join(PKGS, ".venv", "bin", "python"), METIS_LOOP_AGENT_PY: AGENT_PY },
	});
	const out = JSON.parse(readFileSync(join(dir, ".metis", "seeded.json"), "utf8"));
	assert.ok(out.ok, `${JSON.stringify(out.checks)}\n${r.stdout.slice(-3000)}`);
	assert.equal(out.gates, 4);                                    // served, edit, readme, take (no commands: no intents, no gate)
});

// loop-fixes s-855d8067: catalog_edit, the gate after a refusal, a world with no commands, display/line
const SDK_PY = () => process.env.TEST_SDK_PY ?? join(PKGS, ".venv", "bin", "python");
const HAS_METISC = (() => {
	const r = spawnSync(SDK_PY(), ["-c", "from metis_loop_sdk import catalog; print(catalog.metisc() or '')"], { encoding: "utf8" });
	return !!r.stdout?.trim();
})();
if (!HAS_METISC && process.env.TEST_REQUIRE_METISC) throw new Error("TEST_REQUIRE_METISC: the loop SDK finds no metisc (METISC)");

// a seed domain in the loop's catalog, its program served by the REPL
const STORY = "% a seed: its header, line one\n% line two\ncatalog story 1.\nlayers (story).\nstages (s).\nnamespace w produce (story).\n" +
	"pred a : w.\npred b : w.\nstage s {\n  %% a becomes b.\n  ab [story] : a -o b.\n}\n#init a 1\n";                 // metisc: no diagnostic
function story(cat: string, text = STORY): string {
	const d = join(cat, "domains", "story");
	mkdirSync(d, { recursive: true });
	writeFileSync(join(d, "story.llp"), text);
	writeFileSync(join(d, "domain.yaml"), "program: story.llp\n");
	return d;
}
const watching = (answers: boolean[] = []) => {
	const shown: string[] = [];
	return { shown, ctx: { hasUI: true, ui: { confirm: async (t: string, b: string) => (shown.push(`${t}\n${b}`), answers.length ? answers.shift()! : true), notify: () => {} } } };
};

test("metis-repl: catalog_edit — one exact edit of the program behind the gate, every comment kept, the REPL serves it again; its refusals", { skip: !HAS_METISC && "no metisc" }, async () => {
	const cat = env(true);
	const d = story(cat);
	process.env.METIS_LOOP_LLP = join(d, "story.llp");
	const p = fakePi();
	repl(p.api);
	await p.emit("session_start", {}, ui(true));
	try {
		const { shown, ctx } = watching();
		const input = { domain: "story", path: "story.llp", old_string: "% line two", new_string: "% line two, edited" };
		const ed = { toolName: "catalog_edit", toolCallId: "d", input };
		assert.equal(await p.emit("tool_call", ed, ctx), undefined);
		assert.ok(shown[0].startsWith(`Edit in the catalog ${cat}: domains/story/story.llp?\n`));
		assert.match(shown[0], /^-% line two\n\+% line two, edited\n/m);
		assert.equal(readFileSync(join(d, "story.llp"), "utf8"), STORY);                        // the dry run wrote nothing
		await assert.rejects(p.tools.get("catalog_apply").execute("d", { domain: "story", what: "served" }), /not approved/);
		assert.equal(await p.emit("tool_call", ed, ctx), undefined);                           // (the plan apply refused is gone)
		const r = await p.tools.get("catalog_edit").execute("d", input);
		assert.equal(r.content[0].text, `applied: domains/story/story.llp. The REPL now serves ${join(d, "story.llp")}.`);
		assert.equal(readFileSync(join(d, "story.llp"), "utf8"), STORY.replace("% line two", "% line two, edited"));   // every other byte
		await assert.rejects(p.tools.get("catalog_edit").execute("z", input), /not approved/);  // no gate, no write
		const refuse = async (i: object, why: RegExp) =>
			assert.match((await p.emit("tool_call", { toolName: "catalog_edit", toolCallId: "r", input: { domain: "story", path: "story.llp", ...i } }, ctx)).reason, why);
		await refuse({ old_string: "% line two\n", new_string: "x" }, /not in it/);
		await refuse({ old_string: "story", new_string: "tale" }, /occurs \d+ times/);
		await refuse({ path: "../other/x.llp", old_string: "a", new_string: "b" }, /not inside the domain/);
		await refuse({ old_string: "ab [story] : a -o b.", new_string: "ab [story] : a -o bb." }, /adds 1 diagnostic[\s\S]*undeclared predicate 'bb'/);
		await refuse({ domain: "nosuch", old_string: "a", new_string: "b" }, /nosuch/);
		assert.equal(shown.length, 2);                                                          // a refusal asks the person nothing
	} finally {
		process.env.METIS_LOOP_LLP = "";
		await p.emit("session_shutdown", {}, {});
	}
});

test("metis-repl: after a refusal the gate shows what changed since that proposal; a README fix is catalog_edit", async () => {
	const cat = env(true);
	const d = story(cat);
	const p = fakePi();
	repl(p.api);
	await p.emit("session_start", {}, ui(true));
	try {
		const { shown, ctx } = watching([false, true, false, true]);
		const rd = (text: string) => ({ toolName: "catalog_apply", toolCallId: "m", input: { domain: "story", what: "readme", title: "a seed", text } });
		assert.equal((await p.emit("tool_call", rd("One. Twi."), ctx)).reason, "the person did not approve this write");
		assert.match(shown[0], /README\.md \(new\)\?/);
		// never written: an edit of it says how to fix it (the live run's model tried that first)
		const early = { toolName: "catalog_edit", toolCallId: "x", input: { domain: "story", path: "README.md", old_string: "Twi.", new_string: "Two." } };
		assert.match((await p.emit("tool_call", early, ctx)).reason, /README\.md was never written: the person refused its proposal\. Send it again through catalog_apply/);
		assert.match((await p.emit("tool_call", { ...early, input: { ...early.input, path: "./README.md" } }, ctx)).reason, /was never written/);
		// the next proposal: what changed since the refused one, then the diff against the disk
		assert.equal(await p.emit("tool_call", rd("One. Two."), ctx), undefined);
		assert.match(shown[1], /README\.md \(new\) \(changed since you refused it\)\?/);
		assert.match(shown[1], /── domains\/story\/README\.md: since the proposal you refused ──\n--- refused\/domains\/story\/README\.md\n\+\+\+ b\/domains\/story\/README\.md\n@@[^\n]*\n # story — a seed\n \n-One\. Twi\.\n\+One\. Two\.\n/);
		assert.match(shown[1], /── domains\/story\/README\.md: against the file on disk ──\n--- a\/domains\/story\/README\.md/);
		await p.tools.get("catalog_apply").execute("m", rd("One. Two.").input);                // approved: written, forgotten
		const before = readFileSync(join(d, "README.md"), "utf8");
		assert.equal((await p.emit("tool_call", rd("One. Three."), ctx)).reason, "the person did not approve this write");
		assert.doesNotMatch(shown[2], /refused it/);                                             // the refusal before was answered
		assert.equal(await p.emit("tool_call", rd("One. Three."), ctx), undefined);
		assert.match(shown[3], /README\.md \(as you refused it\)\?/);                         // the same text again: said so
		// a fix the person points out: one exact edit of the README, not the whole text again
		const fix = { toolName: "catalog_edit", toolCallId: "f", input: { domain: "story", path: "README.md", old_string: "One. Two.", new_string: "One, two." } };
		assert.equal(await p.emit("tool_call", fix, ctx), undefined);
		assert.match(shown[4], /^-One\. Two\.\n\+One, two\.\n/m);
		await p.tools.get("catalog_edit").execute("f", fix.input);
		assert.equal(readFileSync(join(d, "README.md"), "utf8"), before.replace("One. Two.", "One, two."));
		// the file moves between the gate and the write: the write is refused, nothing written (review note 5b)
		const again = { ...fix, toolCallId: "g", input: { ...fix.input, old_string: "One, two.", new_string: "One; two." } };
		assert.equal(await p.emit("tool_call", again, ctx), undefined);
		const moved = readFileSync(join(d, "README.md"), "utf8").replace("# story — a seed", "# story — a seed, moved");
		writeFileSync(join(d, "README.md"), moved);
		await assert.rejects(p.tools.get("catalog_edit").execute("g", again.input), /changed after the person approved the edit: nothing written/);
		assert.equal(readFileSync(join(d, "README.md"), "utf8"), moved);
	} finally {
		await p.emit("session_shutdown", {}, {});
	}
});

test("metis-repl: a world with no commands — what=intents writes no intent.yaml (the SDK's switch) and asks the person nothing; without the switch, UNKNOWN only", async () => {
	const cat = env(true);
	const d = story(cat);
	const p = fakePi();
	repl(p.api);
	await p.emit("session_start", {}, ui(true));
	const { shown, ctx } = watching();
	const it = { toolName: "catalog_apply", toolCallId: "i", input: { domain: "story", what: "intents" } };
	try {
		process.env.METIS_CATALOG_INTENTLESS = "1";
		assert.equal(await p.emit("tool_call", it, ctx), undefined);
		assert.equal(shown.length, 0);
		const r = await p.tools.get("catalog_apply").execute("i", it.input);
		assert.match(r.content[0].text, /^no intent\.yaml: the world takes no commands/);
		assert.ok(!existsSync(join(d, "intent.yaml")) && !existsSync(join(d, "intent")));
		process.env.METIS_CATALOG_INTENTLESS = "0";
		assert.equal(await p.emit("tool_call", it, ctx), undefined);
		assert.match(shown[0], /domains\/story\/intent\.yaml \(new\)[\s\S]*\+# story's intents: the world takes no commands/);
		assert.doesNotMatch(shown[0], /DRAFT|spoken\.txt/);                                     // not a draft; no empty file
	} finally {
		delete process.env.METIS_CATALOG_INTENTLESS;
		await p.emit("session_shutdown", {}, {});
	}
});

test("metis-repl: what=served takes display and line for the new domain's manifest", async () => {
	const cat = env(true);
	const seed = join(mkdtempSync(join(tmpdir(), "loop-seed-")), "story.llp");
	writeFileSync(seed, STORY);
	process.env.METIS_LOOP_LLP = seed;
	const p = fakePi();
	repl(p.api);
	await p.emit("session_start", {}, ui(true));
	try {
		const { shown, ctx } = watching();
		const sv = { toolName: "catalog_apply", toolCallId: "v", input: { domain: "story", what: "served", display: "the story", line: "an a that becomes a b" } };
		assert.match((await p.emit("tool_call", { ...sv, input: { ...sv.input, line: "two\nlines" } }, ctx)).reason, /line is one line/);
		assert.equal(await p.emit("tool_call", sv, ctx), undefined);
		await p.tools.get("catalog_apply").execute("v", sv.input);
		const mf = readFileSync(join(cat, "domains", "story", "domain.yaml"), "utf8");
		assert.match(mf, /^display: the story$/m);
		assert.match(mf, /^line: an a that becomes a b$/m);
		assert.match(mf, /^program: story\.llp$/m);
	} finally {
		process.env.METIS_LOOP_LLP = "";
		await p.emit("session_shutdown", {}, {});
	}
});

test("metis-domain: J from intent.yaml, T from tools.json, the clock; a surprise is steered in", async () => {
	const cat = env(true);
	const d = join(cat, "domains", "lamp");
	writeFileSync(join(d, "lamp.llp"), "catalog lamp 1.\n");
	writeFileSync(join(d, "domain.yaml"), "program: lamp.llp\nintent: {spec: intent.yaml}\n");
	writeFileSync(join(d, "intent.yaml"), "verbs:\n- verb: SWITCH_ON\n  meaning: The person switches the lamp on.\nslots: {}\n");
	Object.assign(process.env, {
		METIS_LOOP_AGENT_PY: process.env.TEST_AGENT_PY ?? join(AGENT, "py", ".venv", "bin", "python"),
		METIS_LOOP_AGENT_DIR: join(HERE, "stub"),
	});
	const p = fakePi();
	domain(p.api);
	const o = await p.tools.get("domain_open").execute("o", { domain: "lamp" });
	assert.match(o.content[0].text, /lamp is open at beat 0; 1 intent verb/);
	for (const t of ["intent_switch_on", "domain_state", "domain_why", "domain_explain", "domain_consult", "domain_clock"]) assert.ok(p.tools.has(t), t);
	assert.ok(!p.tools.has("domain_activate") && !p.tools.has("domain_keep"));      // the orchestrator's, not the domain agent's
	assert.match((await p.tools.get("intent_switch_on").execute("i", {})).content[0].text, /accepted: Accepted\./);
	assert.match((await p.tools.get("domain_state").execute("s", { domain: "lamp" })).content[0].text, /stage main/);
	const c = await p.tools.get("domain_clock").execute("k", { n: 3 });
	assert.match(c.content[0].text, /SURPRISE record 0: \{"lit":-1,"dark":1\}[\s\S]*clock: beat 3/);
	assert.equal(p.messages.length, 1);
	assert.equal(p.messages[0].opts.deliverAs, "steer");
	assert.match(p.messages[0].msg.content, /signals a surprise/);
	await p.emit("session_shutdown", {}, {});
});

test("metis-domain: a beat that never settles — the clock says unsettled with its rules, the repeated events once each with a count", async () => {
	const cat = env(true);
	const d = join(cat, "domains", "lamp");
	writeFileSync(join(d, "lamp.llp"), "catalog lamp 1.\n");
	writeFileSync(join(d, "domain.yaml"), "program: lamp.llp\nintent: {spec: intent.yaml}\n");
	writeFileSync(join(d, "intent.yaml"), "verbs:\n- verb: SWITCH_ON\n  meaning: The person switches the lamp on.\nslots: {}\n");
	Object.assign(process.env, {
		METIS_LOOP_AGENT_PY: process.env.TEST_AGENT_PY ?? join(AGENT, "py", ".venv", "bin", "python"),
		METIS_LOOP_AGENT_DIR: join(HERE, "stub"),
		STUB_SPIN: "1",
	});
	const p = fakePi();
	domain(p.api);
	try {
		await p.tools.get("domain_open").execute("o", { domain: "lamp" });
		const c = await p.tools.get("domain_clock").execute("k", { n: 2 });
		const text: string = c.content[0].text;
		assert.equal(c.details.lines.filter((l: any) => l.kind === "event").length, 400);   // the lines themselves, all kept
		assert.deepEqual(text.split("\n"), [
			"event persist_lit fired ×200, beat 0: The lamp stays lit.",
			"event persist_dark fired ×200, beat 0: The lamp stays dark.",
			"UNSETTLED quiescence: the lamp did not settle: 200 steps in one beat, and persist_dark (100), persist_lit (100) kept firing; " +
				'the beat stopped there unsettled [["persist_dark",100],["persist_lit",100]]',
			"clock: beat 0",
			"UNSETTLED quiescence: the lamp did not settle: 200 steps in one beat, and persist_dark (100), persist_lit (100) kept firing; " +
				'the beat stopped there unsettled [["persist_dark",100],["persist_lit",100]]',
			"clock: beat 0",
		]);
		assert.equal(p.messages.length, 0);   // no steer: the clock's own answer carries it
	} finally {
		delete process.env.STUB_SPIN;
		await p.emit("session_shutdown", {}, {});
	}
});

// a program-only domain (agent-no-intent s-7fd29000): a fiction world with no intent.yaml opens
// through domain_open on the real domain agent, with no intent tool; its clock beats and the
// REPL reads answer. Scripted, no model; skipped where metis-agent is not installed
test("metis-domain: a domain with no intents (love_triangle) opens with no verbs, beats and reads", { skip: !hasAgent && "no metis-agent" }, async () => {
	env(false);
	const cat = join(CATALOG);
	Object.assign(process.env, {
		METIS_CATALOG: cat, METIS_LOOP_METIS: process.env.REAL_METIS!, METIS_LOOP_RECORDS: "",
		METIS_LOOP_AGENT_PY: AGENT_PY, METIS_LOOP_AGENT_DIR: join(AGENT, "py"),
	});
	assert.ok(!existsSync(join(cat, "domains", "love_triangle", "intent.yaml")));
	const p = fakePi();
	domain(p.api);
	const o = await p.tools.get("domain_open").execute("o", { domain: "love_triangle" });
	assert.match(o.content[0].text, /love_triangle is open at beat 0; 0 intent verb\(s\)/);
	assert.ok(![...p.tools.keys()].some((t) => t.startsWith("intent_")));
	const c = await p.tools.get("domain_clock").execute("k", { n: 2 });
	assert.match(c.content[0].text, /jealousy/);
	assert.match((await p.tools.get("domain_state").execute("s", { domain: "love_triangle" })).content[0].text, /anger\(/);
	await p.emit("session_shutdown", {}, {});
});

// an RDDL world (rddl-worlds s-242c7c3f step 1): nav, a host with no intents over the IPPC 2011
// Navigation gym, opens through domain_open on the real domain agent; its program moves the robot,
// the gym answers, the clock runs to the gym's horizon. Skipped where metis-agent or pyRDDLGym is missing
const hasGym = hasAgent && spawnSync(process.env.METIS_RDDL_PY ?? join(PKGS, ".venv", "bin", "python"), ["-c", "import pyRDDLGym"]).status === 0;
if (!hasGym && process.env.TEST_REQUIRE_GYM) throw new Error("TEST_REQUIRE_GYM: no interpreter with pyRDDLGym ($METIS_RDDL_PY)");
test("metis-domain: an RDDL world (nav) opens with no verbs; its program acts, the gym answers to the horizon", { skip: !hasGym && "no metis-agent or pyRDDLGym" }, async () => {
	env(false);
	Object.assign(process.env, {
		METIS_CATALOG: join(CATALOG), METIS_LOOP_METIS: process.env.REAL_METIS!, METIS_LOOP_RECORDS: "",
		METIS_LOOP_AGENT_PY: AGENT_PY, METIS_LOOP_AGENT_DIR: join(AGENT, "py"),
	});
	const p = fakePi();
	domain(p.api);
	try {
		const o = await p.tools.get("domain_open").execute("o", { domain: "nav" });
		assert.match(o.content[0].text, /nav is open at beat 0; 0 intent verb\(s\)/);
		const c = await p.tools.get("domain_clock").execute("k", { n: 50 });
		assert.match(c.content[0].text, /(mv|die)_(north|south|east|west)/);
		assert.match(c.content[0].text, /over|episode/);
		assert.match((await p.tools.get("domain_state").execute("s", { domain: "nav" })).content[0].text, /stage /);
	} finally {
		await p.emit("session_shutdown", {}, {});
	}
});

// rddl-worlds s-242c7c3f step 1 (B): a world without intents exercised through its ports, world lines and
// measured episodes (nav against its gym; scripted, no model)
function navCatalog(edit?: (dir: string) => void, name = "nav"): string {
	const r = mkdtempSync(join(tmpdir(), `loop-${name}-`));
	cpSync(join(CATALOG, "tools"), join(r, "tools"), { recursive: true, filter: (s) => !s.includes("__pycache__") });
	cpSync(join(CATALOG, "domains", name), join(r, "domains", name), { recursive: true, filter: (s) => !/\/(build|records)(\/|$)/.test(s) });
	edit?.(join(r, "domains", name));
	return r;
}
async function openNav(cat: string, name = "nav") {
	env(false);
	Object.assign(process.env, {
		METIS_CATALOG: cat, METIS_LOOP_METIS: process.env.REAL_METIS!, METIS_LOOP_RECORDS: "",
		METIS_LOOP_AGENT_PY: AGENT_PY, METIS_LOOP_AGENT_DIR: join(AGENT, "py"),
		METIS_RDDL_PY: process.env.METIS_RDDL_PY ?? join(PKGS, ".venv", "bin", "python"), // a scratch catalog has no .venv beside it
	});
	const p = fakePi();
	domain(p.api);
	await p.tools.get("domain_open").execute("o", { domain: name });
	return p;
}

test("metis-domain: domain_ports and domain_world on an RDDL world (nav): the gym, its atoms and actions; world lines taken or refused", { skip: !hasGym && "no metis-agent or pyRDDLGym" }, async () => {
	const p = await openNav(navCatalog());
	try {
		const ports = (await p.tools.get("domain_ports").execute("p", {})).content[0].text;
		assert.match(ports, /^gym: problem "Navigation_MDP_ippc2011", instance "1", seed 1, step 0, horizon 40, done false/);
		assert.match(ports, /observed atoms \(12\): at\(x14_y12\) /);
		assert.match(ports, /derived atoms: dead\nactions: move-east move-north move-south move-west\nweight ports the host binds: die go\n/);
		assert.match(ports, /world lines: taken/);
		const w = await p.tools.get("domain_world").execute("w", { lines: ["teleport"] });
		assert.match(w.content[0].text, /^refused: .*world lines are/);
		const ok = await p.tools.get("domain_world").execute("w2", { lines: ["seed 7"] });
		assert.match(ok.content[0].text, /^world: seed 7 — taken/);
	} finally {
		await p.emit("session_shutdown", {}, {});
	}
});

test("metis-domain: domain_episodes — 20 seeded nav episodes, deterministic, no surprise on the true program; a wrong rate lowers the likelihood, a deleted rule makes outcomes impossible", { skip: !hasGym && "no metis-agent or pyRDDLGym" }, async () => {
	const run = async (cat: string, n = 20) => {
		const p = await openNav(cat);
		try {
			return await p.tools.get("domain_episodes").execute("e", { n, seed: 1 });
		} finally {
			await p.emit("session_shutdown", {}, {});
		}
	};
	const mean = (d: any) => {
		const eps = d.episodes.filter((e: any) => e.loglik !== null);
		return eps.reduce((a: number, e: any) => a + e.loglik, 0) / eps.reduce((a: number, e: any) => a + e.scored, 0);
	};
	const cat = navCatalog();
	const a = await run(cat), b = await run(cat);
	assert.deepEqual(a.details, b.details);                                                   // deterministic per seed
	const t = a.content[0].text;
	assert.equal(a.details.measure, "outcome");
	assert.equal(a.details.episodes.length, 20);
	assert.ok(a.details.episodes.every((e: any) => e.over && e.done && e.step === 40));       // each to the gym's horizon
	assert.ok(a.details.episodes.every((e: any) => e.surprises === 0 && e.loglik !== null));  // the program can say what the gym does
	assert.match(t, /^20 episode\(s\), seeds 1–20;/);
	assert.match(t, /\noutcome dead: 0 in \d+\/20, 1 in \d+\/20\n/);
	assert.match(t, /\ngym reward: mean -?[\d.]+, min -?[\d.]+, max -?[\d.]+; episodes done 20\/20\n/);
	assert.match(t, /likelihood under the program, P\(the world's answer \| the action the program sent\), per action: \d+ scored/);
	assert.match(t, /the least likely answers of the world: seed \d+ beat \d+: the program drew (mv|die)_\w+\[[^\]]*\]; the world answered (mv|die)_\w+\[[^\]]*\] \(move-\w+\), which the program gives p = [\d.e-]+/);
	assert.match(t, /per episode: seed 1: ends with [^,]+, \d+ beats, /);              // its outcome, not only its reward
	assert.match(t, /seed \d+: ends with at\(x21_y20\), \d+ beats, \d+ scored, log -?[\d.]+, reward -?\d+/);   // the goal, said as the goal
	// a wrong rate, every rule kept (die ×5): nothing is impossible, the likelihood drops
	const five = await run(navCatalog((d) => {
		const h = join(d, "nav_host.py");
		writeFileSync(h, readFileSync(h, "utf8").replace("else _p(host, c2)", "else 5 * _p(host, c2)"));
	}));
	assert.ok(five.details.episodes.every((e: any) => e.surprises === 0 && e.loglik !== null));
	assert.ok(mean(five.details) < mean(a.details) - 0.1, `die ×5: ${mean(five.details)} against ${mean(a.details)}`);
	// a deleted rule (the die rules gone): the gym's deaths are answers the program cannot give
	const gone = await run(navCatalog((d) => {
		const f = join(d, "nav_domain.llp");
		writeFileSync(f, readFileSync(f, "utf8").split("\n").filter((l) => !l.includes("die_") && !l.includes("claims the robot")).join("\n"));
	}), 10);
	assert.ok(gone.details.episodes.filter((e: any) => e.loglik === null).length >= 5);
	assert.match(gone.content[0].text, /zero-probability episodes ([5-9]|10)\/10/);
});

// rddl-worlds step 3 (opus's finding 8): an observing world (wildfire: the host acts, the program sends no action)
// was "0 scored, zero-probability episodes 0/N" beside a surprise in every episode; its beats are scored by
// their reading. rddl-watch s-cfe94dca: the pass restarts at every beat (step 3 stalled at the second, a p = 0
// beat), so the readings are the program's to price: no beat is impossible
test("metis-domain: domain_episodes on an observing world (wildfire) scores its beats by the reading; every pass is priced", { skip: !hasGym && "no metis-agent or pyRDDLGym" }, async () => {
	const p = await openNav(navCatalog(undefined, "wildfire"), "wildfire");
	try {
		const d = await p.tools.get("domain_episodes").execute("e", { n: 2, seed: 1, max_beats: 4 });
		const t = d.content[0].text;
		assert.equal(d.details.measure, "outcome");
		assert.ok(d.details.episodes.every((e: any) => e.scored === 0 && e.idle.scored === 4 && e.idle.zero === 0 && e.loglik !== null));
		assert.match(t, /per action \(the program sent none: the host acts, an observing world\): 0 scored;/);
		assert.match(t, /zero-probability episodes 0\/2/);
		assert.match(t, /\nbeats with no action the program sent, P\(the host's reading \| the beat's last input\): 8 scored; mean log per beat -?\d+\.\d+ [^\n]*; p = 0 in 0 beat\(s\) of 0\/2 episode\(s\)\n/);
		assert.match(t, /\nthe reading per beat, as the watch prices it: 8 beats, tier exact \d, sampled \d[^\n]*; zero: exact 0 \(impossible\), sampled 0/);
		assert.match(t, /seed 1: [^;]*, 4 beats with no action \(log -?\d+\.\d+\)/);
	} finally {
		await p.emit("session_shutdown", {}, {});
	}
});

// rddl-watch s-cfe94dca, opus's finding 1: a lockstep world past the exact filter's budget is priced on the sampled
// tier, and its zero is no run of n reaching the reading (below the tier's resolution), not an impossible one. tamarisk
// seed 1 has two in its first four beats (the domain agent's measure, deterministic): counted apart, never a p = 0
// beat, and the episode keeps its likelihood; the tier is printed
test("metis-domain: domain_episodes counts a sampled tier's zero apart (tamarisk), never as impossible, and prints the tier", { skip: !hasGym && "no metis-agent or pyRDDLGym" }, async () => {
	const p = await openNav(navCatalog(undefined, "tamarisk"), "tamarisk");
	try {
		const d = await p.tools.get("domain_episodes").execute("e", { n: 1, seed: 1, max_beats: 4 });
		const t = d.content[0].text;
		const [e] = d.details.episodes;
		assert.equal(e.idle.scored, 4);
		assert.equal(e.idle.sampledZero, 2);
		assert.equal(e.idle.zero, 0);
		assert.equal(e.zero, 0);
		assert.notEqual(e.loglik, null);
		assert.equal(e.read.exact + e.read.sampled, 4);
		assert.ok(e.read.sampled >= 2 && e.read.n === 500 && e.read.sampledZero === 2 && e.read.exactZero === 0);
		assert.match(t, /zero-probability episodes 0\/1/);
		assert.match(t, /; p = 0 in 0 beat\(s\) of 0\/1 episode\(s\); sampled zeros \(below the tier's resolution, not impossible\) 2 in 1\/1 episode\(s\)\n/);
		assert.match(t, /\nthe reading per beat, as the watch prices it: 4 beats, tier exact \d, sampled \d \(500 seeded runs each, 95% half-width up to 0\.\d{3}\)[^\n]*; zero: exact 0 \(impossible\), sampled 2 \(no run of 500 reached the reading: p < 0\.0076 at 95%, not impossible\)\n/);
		assert.match(t, /no run of 500 reached it \(seed \d+; p < 0\.0076 at 95%\)/);
	} finally {
		await p.emit("session_shutdown", {}, {});
	}
});

// rddl-worlds B, the architect's ruling: loop.sh --seed takes a domain package as well (its program, included
// files, host and manifest), copied whole as a catalog of its own; the single-file seed stays
test("loop.sh --seed PKG_DIR: the package whole in DIR/.metis/seed/domains/NAME/, its program served there; a directory without a manifest is refused", () => {
	const run = (dir: string, ...args: string[]) => loopIn(dir, args);
	const src = join(mkdtempSync(join(tmpdir(), "loop-pkgsrc-")), "pigs");
	mkdirSync(join(src, "build"), { recursive: true });
	writeFileSync(join(src, "domain.yaml"), "display: the pigs\nprogram: pigs.llp\n");
	writeFileSync(join(src, "pigs.llp"), 'catalog pigs 1.\ninclude "pigs_rules.llp".\n');
	writeFileSync(join(src, "pigs_rules.llp"), "catalog pigs-rules 1.\n");
	writeFileSync(join(src, "build", "pigs.metis"), "a bundle\n");
	const dir = mkdtempSync(join(tmpdir(), "loop-pkgseeded-"));
	const a = run(dir, "--seed", src + "/");
	assert.equal(a.code, 0, a.err);
	const at = join(dir, ".metis", "seed", "domains", "pigs");
	assert.equal(a.out.env.METIS_LOOP_LLP, join(at, "pigs.llp"));                     // served where its includes resolve
	assert.equal(a.out.env.METIS_RDDL_PY, process.env.METIS_RDDL_PY ?? join(PKGS, ".venv", "bin", "python")); // an RDDL host's gym (step 2, finding 1)
	assert.deepEqual(readdirSync(at).sort(), ["domain.yaml", "pigs.llp", "pigs_rules.llp"]); // no build/
	// no tools/ copied: an RDDL host imports rddl_host from the installed metis-catalog's tools/, on PYTHONPATH
	assert.ok(!existsSync(join(dir, ".metis", "seed", "tools")));
	const tools = JSON.parse(spawnSync(process.env.TEST_SDK_PY ?? join(PKGS, ".venv", "bin", "python"),
		["-m", "metis_loop_sdk.catalog", "installed", "--json"], { encoding: "utf8" }).stdout).tools;
	assert.equal(a.out.env.PYTHONPATH.split(":")[0], tools);
	assert.deepEqual(JSON.parse(readFileSync(join(dir, ".metis", "seed.json"), "utf8")), { seed: src, name: "pigs", package: true });
	assert.equal(run(dir, "--seed", src).code, 0);                                      // the same package again: the same run
	const bare = mkdtempSync(join(tmpdir(), "loop-pkgbare-"));
	assert.match(run(mkdtempSync(join(tmpdir(), "loop-pkgseeded-")), "--seed", bare).err, /a directory seed is a domain package \(its domain.yaml\)/);
});

test("example/seeded.ts on a package (nav): served whole with its include and host, measured, edited, taken whole", { skip: !hasGym && "no metis-agent or pyRDDLGym" }, () => {
	const dir = mkdtempSync(join(tmpdir(), "loop-seeded-nav-"));
	const r = spawnSync(join(PKGS, "metis-agentic-loop", "node", "bin", "node"),
		["--experimental-strip-types", "--no-warnings", join(HERE, "..", "example", "seeded.ts"), join(CATALOG, "domains", "nav"), dir], {
		encoding: "utf8", timeout: 300000,
		env: { ...process.env, METIS_LOOP_METIS: process.env.REAL_METIS ?? join(PKGS, ".venv", "bin", "metis"),
			METIS_LOOP_SDK_PY: process.env.TEST_SDK_PY ?? join(PKGS, ".venv", "bin", "python"), METIS_LOOP_AGENT_PY: AGENT_PY },
	});
	const out = JSON.parse(readFileSync(join(dir, ".metis", "seeded.json"), "utf8"));
	assert.ok(out.ok, `${JSON.stringify(out.checks)}\n${r.stdout.slice(-3000)}`);
	assert.equal(out.gates, 3);                                                // served (the package), edit, take
	for (const c of ["the package came whole, every file byte for byte", "its episodes are measured, the likelihood per action",
		"the same seeds measure the same", "the target has every other file of the package"])
		assert.equal(out.checks[c], true, c);
});

test("metis-repl: what=served on a package seed says that a display and line given are not used (rddl-worlds step 2, finding 2)", async () => {
	const cat = env(true);
	const run = mkdtempSync(join(tmpdir(), "loop-pkgrun-"));
	const pkg = join(run, "seed", "domains", "pigs");
	mkdirSync(pkg, { recursive: true });
	writeFileSync(join(pkg, "domain.yaml"), "display: the pigs\nline: three pigs and a wolf\nprogram: pigs.llp\n");
	writeFileSync(join(pkg, "pigs.llp"), "% the pigs\ncatalog pigs 1.\n");
	writeFileSync(join(run, "seed.json"), JSON.stringify({ seed: pkg, name: "pigs", package: true }));
	Object.assign(process.env, { METIS_LOOP_RUN: run, METIS_LOOP_LLP: join(pkg, "pigs.llp") });
	const p = fakePi();
	repl(p.api);
	await p.emit("session_start", {}, ui(true));
	try {
		const sv = { toolName: "catalog_apply", toolCallId: "v", input: { domain: "pigs", what: "served", display: "the dog", line: "a robot dog" } };
		assert.equal(await p.emit("tool_call", sv, ui(true)), undefined);
		const r = (await p.tools.get("catalog_apply").execute("v", sv.input)).content[0].text;
		assert.match(r, /^applied: domains\/pigs\/pigs\.llp, domains\/pigs\/domain\.yaml\./);
		assert.match(r, /The package's own domain\.yaml is used as it is, so the display and line given here were not: it has display "the pigs" and line "three pigs and a wolf"\./);
		assert.equal(readFileSync(join(cat, "domains", "pigs", "domain.yaml"), "utf8"), readFileSync(join(pkg, "domain.yaml"), "utf8"));
		// nothing given, nothing said
		rmSync(join(cat, "domains", "pigs"), { recursive: true });
		const plain = { ...sv, toolCallId: "w", input: { domain: "pigs", what: "served" } };
		assert.equal(await p.emit("tool_call", plain, ui(true)), undefined);
		assert.doesNotMatch((await p.tools.get("catalog_apply").execute("w", plain.input)).content[0].text, /were not/);
	} finally {
		delete process.env.METIS_LOOP_RUN;
		process.env.METIS_LOOP_LLP = "";
		await p.emit("session_shutdown", {}, {});
	}
});
