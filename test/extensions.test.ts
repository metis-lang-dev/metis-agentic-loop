// The two extensions against stand-ins (no model, no pi session): the tools are
// generated from the interfaces' declarations, the apply gate holds (no person,
// a refusal, an ungated candidate) and writes only what the person approved,
// and a domain's surprise enters the loop as a steered message.
//   node/bin/node --experimental-strip-types --test test/extensions.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import repl from "../extensions/metis-repl.ts";
import domain from "../extensions/metis-domain.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
// the sibling checkouts (metis-agentic-loop beside metispy's venv and metis-agent);
// CI points these at its own installs
const PKGS = join(HERE, "..", "..");
const AGENT = join(PKGS, "metis-agent");

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
	assert.deepEqual([...p.tools.keys()].sort(), ["catalog_apply", "catalog_take", "repl_formalize", "repl_gate", "repl_show", "repl_state", "repl_text"]);
	assert.match(p.tools.get("repl_state").description, /the domain's current state/);
	assert.match(p.tools.get("repl_text").description, /finding: metispy/);
	const r = await p.tools.get("repl_text").execute("c1", { arg: "a desk lamp" });
	assert.equal(r.content[0].text, "text a desk lamp");
	await p.emit("session_shutdown", {}, {});
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
	// the intent generator the SDK runs on the catalog (loop.sh's scratch copies it the same way)
	cpSync(join(PKGS, "metis-catalog", "tools"), join(cat, "tools"), { recursive: true });
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
	assert.deepEqual([...i.details.written].sort(), ["domains/lamp/domain.yaml", "domains/lamp/intent.yaml",
		"domains/lamp/intent/lamp-prompt.txt", "domains/lamp/intent/lamp-spoken.txt", "domains/lamp/intent/lamp.gbnf"]);
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
		assert.match((await p.emit("tool_call", take, ui(true))).reason, /METIS_LOOP_TAKE_INTO is not set/);
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
		// what=readme: a gated README for a known domain, the text as given
		const rd = { toolName: "catalog_apply", toolCallId: "m", input: { domain: "story", what: "readme", text: "# story — a seed\n\nFrom its header." } };
		assert.equal(await p.emit("tool_call", rd, watch), undefined);
		assert.match(shown[1], /domains\/story\/README\.md \(new\)[\s\S]*\+# story — a seed/);
		await p.tools.get("catalog_apply").execute("m", rd.input);
		assert.equal(readFileSync(join(cat, "domains", "story", "README.md"), "utf8"), "# story — a seed\n\nFrom its header.\n");
		assert.match((await p.emit("tool_call", { ...rd, input: { domain: "story", what: "readme" } }, watch)).reason, /text is the README/);
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
		// once the domain is in the catalog (the seed applied), a change is its diff
		writeFileSync(join(cat, "domains", "lamp", "lamp.llp"), "catalog lamp 1.\n");
		writeFileSync(join(cat, "domains", "lamp", "domain.yaml"), "program: lamp.llp\n");
		const shown: string[] = [];
		const watch = { hasUI: true, ui: { confirm: async (t: string, b: string) => (shown.push(`${t}\n${b}`), true), notify: () => {} } };
		assert.equal(await p.emit("tool_call", { toolName: "catalog_apply", toolCallId: "q", input: { domain: "lamp", what: "program" } }, watch), undefined);
		assert.match(shown[0], /domains\/lamp\/lamp\.llp\?[\s\S]*--- a\/domains\/lamp\/lamp\.llp[\s\S]*\+% the stub's candidate/);   // not (new): a diff
		// an unseeded run: a new domain's program as before
		delete process.env.METIS_LOOP_RUN;
		const r = await p.emit("tool_call", { toolName: "catalog_apply", toolCallId: "u", input: { domain: "other", what: "program" } }, watch);
		assert.equal(r, undefined);
		assert.match(shown[1], /domains\/other\/other\.llp \(new\)/);
	} finally {
		delete process.env.METIS_LOOP_RUN;
		await p.emit("session_shutdown", {}, {});
	}
});

test("loop.sh --seed: the run's seed, its name, the task as pi's first message; a run is seeded once", () => {
	const run = (dir: string, ...args: string[]) => {
		const r = spawnSync(join(HERE, "..", "loop.sh"), ["--scratch", dir, ...args], {
			encoding: "utf8",
			env: { ...process.env, METIS_LOOP_PI: join(HERE, "stub", "pi"), MODEL: "ollama/metis-gemma4-e4b-cpu", METIS_CONFIG: "",
				METIS_LOOP_SDK_PY: process.env.TEST_SDK_PY ?? join(PKGS, ".venv", "bin", "python"), METIS_LOOP_TAKE_INTO: "" },
		});
		return { code: r.status, out: r.stdout ? JSON.parse(r.stdout) : null, err: r.stderr };
	};
	const src = mkdtempSync(join(tmpdir(), "loop-seedsrc-#&-"));                      // the task's fill takes any path
	writeFileSync(join(src, "love-story.llp"), "catalog love-story 1.\n");
	writeFileSync(join(src, "3lp.llp"), "catalog three-pigs 1.\n");
	const dir = mkdtempSync(join(tmpdir(), "loop-seeded-"));
	const a = run(dir, "--seed", join(src, "love-story.llp"));
	assert.equal(a.code, 0, a.err);
	assert.equal(a.out.env.METIS_LOOP_LLP, join(dir, "seed", "love_story.llp"));     // the stem, - as _
	assert.equal(readFileSync(join(dir, "seed", "love_story.llp"), "utf8"), "catalog love-story 1.\n");
	assert.deepEqual(JSON.parse(readFileSync(join(dir, "seed.json"), "utf8")), { seed: join(src, "love-story.llp"), name: "love_story" });
	assert.equal(a.out.env.METIS_LOOP_RUN, dir);
	assert.equal(a.out.env.METIS_CATALOG, join(dir, "catalog"));
	assert.ok(!existsSync(join(dir, "catalog", "domains", "lamp")) && !existsSync(join(dir, "catalog", "domains", "plant")));
	const task = a.out.args[a.out.args.length - 1];
	// the exact path (it holds # and &: bash's patsub_replacement must not expand the &)
	assert.ok(task.includes("The REPL serves an existing program, the seed: `" + join(src, "love-story.llp") + "`. Make it the catalog domain `love_story`"), task.slice(0, 300));
	assert.match(task, /`catalog_apply` with domain=love_story what=served/);
	assert.equal(readFileSync(join(dir, "seed", "task.md"), "utf8").trim(), task.trim());
	assert.equal(run(dir, "--seed", join(src, "love-story.llp")).code, 0);              // the same seed again: the same run
	assert.match(run(dir, "--seed", join(src, "3lp.llp"), "--name", "pigs").err, /seeded otherwise/);
	assert.match(run(dir).err, /is a seeded run/);
	const rpc = run(dir, "--seed", join(src, "love-story.llp"), "--mode", "rpc");
	assert.equal(rpc.out.args[rpc.out.args.length - 1], "rpc");                        // a client sends the task itself
	const d2 = mkdtempSync(join(tmpdir(), "loop-seeded-"));
	assert.match(run(d2, "--seed", join(src, "3lp.llp")).err, /'3lp': lowercase letters, digits, _ \(give --name NAME\)/);
	assert.equal(run(d2, "--seed", join(src, "3lp.llp"), "--name", "three_pigs").out.env.METIS_LOOP_LLP, join(d2, "seed", "three_pigs.llp"));
	assert.match(run(mkdtempSync(join(tmpdir(), "loop-seeded-")), "--name", "x").err, /--name goes with --seed/);
	const plain = mkdtempSync(join(tmpdir(), "loop-plain-"));
	assert.equal(run(plain).code, 0);                                                    // unseeded: the lamp's world, as before
	assert.ok(existsSync(join(plain, "catalog", "domains", "lamp", "lamp_host.py")));
	assert.match(run(plain, "--seed", join(src, "3lp.llp"), "--name", "p").err, /unseeded catalog already/);
});

// the seeded start end to end with the real processes (example/seeded.ts): metis, the domain
// agent and the loop SDK, into a scratch target; skipped where metis-agent is not installed
const AGENT_PY = process.env.TEST_AGENT_PY ?? join(AGENT, "py", ".venv", "bin", "python");
const hasAgent = spawnSync(AGENT_PY, ["-c", "import metis_agent.intent_domain"], { cwd: join(AGENT, "py") }).status === 0;
test("example/seeded.ts: a fiction program seeded, applied as it is, opened, run and taken", { skip: !hasAgent && "no metis-agent" }, () => {
	const dir = mkdtempSync(join(tmpdir(), "loop-seeded-e2e-"));
	const r = spawnSync(join(PKGS, "metis-agentic-loop", "node", "bin", "node"),
		["--experimental-strip-types", "--no-warnings", join(HERE, "..", "example", "seeded.ts"),
			join(PKGS, "metis-catalog", "domains", "love_triangle", "love_triangle.llp"), dir], {
		encoding: "utf8", timeout: 240000,
		env: { ...process.env, METIS_LOOP_METIS: process.env.REAL_METIS ?? join(PKGS, ".venv", "bin", "metis"),
			METIS_LOOP_SDK_PY: process.env.TEST_SDK_PY ?? join(PKGS, ".venv", "bin", "python"), METIS_LOOP_AGENT_PY: AGENT_PY },
	});
	const out = JSON.parse(readFileSync(join(dir, "seeded.json"), "utf8"));
	assert.ok(out.ok, `${JSON.stringify(out.checks)}\n${r.stdout.slice(-3000)}`);
	assert.equal(out.gates, 4);                                                           // served, intents, readme, take
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
