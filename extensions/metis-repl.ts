// metis-repl — the metis REPL as pi tools (docs/LOOP-AGENT.md; agentic-loop
// s-3ddb3e87). One `metis --json` process per pi session (the REPL's JSON-lines
// wire, metis.loop.wire): the tools are generated from the wire's own `help`
// — its verb list and the descriptions it declares; a verb it declares
// without a description gets no words from here (a finding against metispy,
// marked in the tool's description). No logic of its own, except the one
// write the wire never makes: catalog_apply, behind pi's tool_call gate (the
// person approves every write into the catalog); catalog_edit, one exact edit of a
// domain's file (comments and all), behind the same gate; and catalog_take, which
// takes a finished domain from the loop's catalog into the person's, behind it too.
// A file the person refused is remembered: its next proposal shows what changed since.
//
// Environment (loop.sh sets them):
//   METIS_LOOP_METIS   the metis console script (metispy's `metis`)
//   METIS_CATALOG      the catalog catalog_apply writes into (loop.sh: the directory it starts in)
//   METIS_LOOP_SDK_PY  a python with the loop SDK: the catalog is its (./sdk: its TypeScript face, setup.sh links it)
//   METIS_CONFIG       the kernel's dot file ([llm]: formalize's endpoint)
//   METIS_LOOP_LLP     optional: the program the REPL starts on (else a blank world)
//   METIS_LOOP_TAKE_INTO the catalog catalog_take takes a domain into (loop.sh --into DIR2; none: it refuses)
//   METIS_LOOP_RUN     the loop's state (DIR/.metis/: records/, seed/, seed.json), for the taken domain's README
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, posix, resolve } from "node:path";
import { Type } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { cap, JsonlChild, type Line } from "./lib/jsonl.ts";
import { runDir, takeRoot, writeRoot } from "./lib/roots.ts";
import * as catalog from "./sdk/catalog.ts";

const NO_WORDS = "(the REPL's wire declares no description for this verb — finding: metispy)";
const ARG = Type.Object({
	arg: Type.Optional(Type.String({ description: "everything after the verb on the REPL line, as a person types it (empty for the bare verb)" })),
});
const NAME = /^[a-z][a-z0-9_]*$/;

export default function (pi: ExtensionAPI) {
	let repl: JsonlChild | null = null;
	let served: string | null = null; // the program file the REPL serves (null: a blank world)
	const registered = new Set<string>();
	const metis = () => process.env.METIS_LOOP_METIS || "metis";

	function spawn(llp: string | null, host: string | null): JsonlChild {
		const args = ["--json", ...(host ? ["--host", host] : []), ...(llp ? [llp] : [])];
		return new JsonlChild(metis(), args, { env: process.env, cwd: llp ? dirname(llp) : process.cwd() }, (l) => signal(l));
	}

	function open(llp: string | null, host: string | null) {
		repl?.close();
		repl = spawn(llp, host);
		served = llp;
	}

	// serve another program; the REPL that was keeps serving (and keeps its
	// candidate) until the new one answers — a program metis cannot load leaves
	// the loop a REPL, not a dead process. null on success, else why it failed.
	async function reopen(llp: string, host: string | null): Promise<string | null> {
		const old = repl, oldServed = served;
		repl = spawn(llp, host);
		served = llp;
		try {
			const h = await op("help"); // metis answers a program it cannot load with ok:false (and exits)
			if (h.ok === false) throw new Error(JSON.stringify(h.findings ?? h));
			await registerVerbs();
			old?.close();
			return null;
		} catch (e) {
			repl.close();
			repl = old;
			served = oldServed;
			return (e as Error).message;
		}
	}

	// a watch's signal lines (event / quiescence / surprise), unasked: into the loop
	function signal(l: Line) {
		pi.sendMessage({ customType: "metis-repl-signal", content: `REPL signal: ${JSON.stringify(l)}`, display: true }, { deliverAs: "steer", triggerTurn: true });
	}

	async function op(verb: string, arg = ""): Promise<Line> {
		if (!repl) throw new Error("the REPL is not running");
		const lines = await repl.request({ op: verb, arg }, (l) => "ok" in l || "error" in l || "findings" in l);
		for (const l of lines.slice(0, -1)) signal(l); // a watch's lines that came before the answer
		return lines[lines.length - 1];
	}

	function text(res: Line): string {
		if (typeof res.text === "string" && res.ok) return res.text;
		const { ok, ...rest } = res;
		return `${ok === false ? "refused: " : ""}${JSON.stringify(rest)}`;
	}

	async function registerVerbs() {
		const help = await op("help");
		const ops = (help.ops as string[]) || [];
		const words = (help.descriptions as Record<string, string>) || {};
		for (const verb of ops) {
			if (!NAME.test(verb) || registered.has(verb)) continue;
			registered.add(verb);
			pi.registerTool({
			executionMode: "sequential", // the tools share one process: one call at a time
				name: `repl_${verb}`,
				label: `metis ${verb}`,
				description: `metis REPL \`${verb}\`: ${words[verb] ?? NO_WORDS}`,
				parameters: ARG,
				async execute(_id, params) {
					const res = await op(verb, (params.arg ?? "").trim());
					return { content: [{ type: "text", text: cap(text(res)) }], details: { verb, arg: params.arg ?? "", result: res } };
				},
			});
		}
		return { ops: ops.length, undescribed: ops.filter((v) => !words[v]) };
	}

	// ---- catalog_apply: the one write, gated --------------------------------
	// through the loop SDK's catalog (its TypeScript face, ./sdk/catalog.ts: the
	// py SDK's CLI): the plan is its dry run (each file's diff, what the person
	// approves), the write its apply with the same text — domain.yaml checked by
	// the catalog's loader, the intent files generated, never a commit

	// root: the catalog the write goes to; run: the write the person approved; tool: whose
	// plan it is (one tool's approval never runs another's write); note: no write, and why
	type Tool = "catalog_apply" | "catalog_edit" | "catalog_take";
	// say: a word for the model with the write's result (what was given and not used)
	type Plan = { tool: Tool; domain: string; root: string; files: catalog.Planned[]; run: () => catalog.Applied; reopen: boolean; note?: string; say?: string };
	type ApplyArgs = { domain: string; what: string; name?: string; text?: string; title?: string; display?: string; line?: string };

	// the last proposal of each file the person refused, by catalog: the next plan diffs from it
	const refused = new Map<string, Map<string, string>>();
	const since = (root: string) => ({ since: Object.fromEntries(refused.get(resolve(root)) ?? []) });
	function remember(pl: Plan, ok: boolean) {
		const k = resolve(pl.root);
		const m = refused.get(k) ?? new Map<string, string>();
		for (const f of pl.files) ok ? m.delete(f.path) : m.set(f.path, f.text);
		refused.set(k, m);
	}

	// a seed (DIR/.metis/seed.json) whose domain is not in the catalog yet
	function seedPending(root: string): boolean {
		let name: string;
		try {
			name = JSON.parse(readFileSync(join(runDir(), "seed.json"), "utf8")).name;
		} catch {
			return false;
		}
		try {
			catalog.get(name, root);
			return false;
		} catch {
			return true;
		}
	}

	async function plan(p: ApplyArgs): Promise<Plan> {
		if (!NAME.test(p.domain)) throw new Error(`domain ${JSON.stringify(p.domain)}: lowercase letters, digits, _`);
		if (!["program", "served", "extension", "intents", "readme"].includes(p.what))
			throw new Error(`what: program | served | extension | intents | readme, not ${JSON.stringify(p.what)}`);
		const root = writeRoot();
		const planned = (w: catalog.Write, reopen = false): Plan => ({
			tool: "catalog_apply", domain: p.domain, root, reopen, files: catalog.plan(p.domain, w, root, since(root)),
			run: () => catalog.apply(p.domain, w, root),
		});
		const shown = { ...(p.display !== undefined ? { display: p.display } : {}), ...(p.line !== undefined ? { line: p.line } : {}) };
		let known = true;
		try {
			catalog.get(p.domain, root);
		} catch {
			known = false;
		}
		// a seeded run applies the seed first: a change to it is then a diff against it, never a "(new)" file
		// (review R2). Once the seed's domain is in the catalog the DIR is a catalog like any: a new domain may be made
		if (!known && seedPending(root) && (p.what === "program" || p.what === "extension"))
			throw new Error(`a seeded run applies the seed first (catalog_apply domain=${p.domain} what=served); a change to it is then its diff against the seed`);
		if (p.what === "readme") {
			// the SDK writes every mechanical part (where it came from, the program's header, how to run it,
			// the intents); the model's words are the summary paragraph and the title only
			if (!known) throw new Error(`no domain ${p.domain} in the loop's catalog yet: its README follows its program`);
			if (!p.text?.trim()) throw new Error("what=readme: text is the summary paragraph (what the program tells; the SDK writes the rest)");
			return planned({ readme: catalog.readme(p.domain, { from: root, run: runDir(), summary: p.text, title: p.title }) });
		}
		if (p.what === "intents") {
			// a first intent.yaml drafted from the program; apply names it in domain.yaml (intent: {spec})
			const sk = catalog.skeleton(p.domain, root);
			if (sk === null)
				return { tool: "catalog_apply", domain: p.domain, root, reopen: false, files: [], run: () => ({ written: [], diff: "", fingerprint: null }),
					note: "no intent.yaml: the world takes no commands (its program has no cmd_* atom), so the agents open it with no verbs" };
			return planned({ intents: sk });
		}
		let text: string;
		// a package seed (loop.sh --seed domains/<name>/): the whole package, as the seed catalog has it
		const seed = (() => {
			try {
				return JSON.parse(readFileSync(join(runDir(), "seed.json"), "utf8"));
			} catch {
				return null;
			}
		})();
		// a seed is applied under its own name: another would leave the seed pending in this DIR for good (review F2)
		if (p.what === "served" && seed && !seed.package && p.domain !== seed.name && seedPending(root))
			throw new Error(`the seed is ${seed.name}: catalog_apply domain=${seed.name} what=served`);
		if (p.what === "served" && seed?.package) {
			if (p.domain !== seed.name) throw new Error(`the seed is the package ${seed.name}: catalog_apply domain=${seed.name} what=served`);
			const from = join(runDir(), "seed");
			// its domain.yaml as it is: a display or line given here is not used, and the result says so
			let say: string | undefined;
			if (p.display !== undefined || p.line !== undefined) {
				const own = catalog.get(p.domain, from);
				say = ` The package's own domain.yaml is used as it is, so the display and line given here were not: it has display ${JSON.stringify(own.display ?? null)} and line ${JSON.stringify(own.line ?? null)}.`;
			}
			return { tool: "catalog_apply", domain: p.domain, root, reopen: true, files: catalog.planTake(p.domain, from, {}, root, since(root)),
				run: () => catalog.take(p.domain, from, {}, root), say };
		}
		if (p.what === "served") {
			// the program the REPL serves, as it is (loop.sh --seed: the seed): no candidate, no rule changed
			if (!served) throw new Error("the REPL serves a blank world: there is no program to apply (loop.sh --seed starts it on one)");
			text = readFileSync(served, "utf8");
		} else {
			const st = await op("show");
			if (!st.candidate) throw new Error("no candidate in the REPL: formalize (or mine + formalize) first");
			if (!st.gated) throw new Error("the candidate has not passed the gate: run repl_gate (an extension) or repl_revise (a program) until it does");
			text = String((await op("show", "llp")).llp ?? "");
			if (!text.endsWith("\n")) text += "\n";
			if (p.what === "extension") {
				const name = p.name && NAME.test(p.name) ? p.name : "";
				if (!name) throw new Error("an extension needs a name (lowercase): it is written to domains/<domain>/extensions/<name>.llp");
				return planned({ extensions: { [name]: text } });
			}
		}
		if (known) return planned({ program: text, ...shown }, true);
		// a new domain: its manifest, the host beside the program when the world brought one
		const host = existsSync(join(root, "domains", p.domain, `${p.domain}_host.py`)) ? `${p.domain}_host.py:make` : null;
		const manifest =
			`# written by the agentic loop's catalog_apply (docs/LOOP-AGENT.md)\nprogram: ${p.domain}.llp\n` +
			(host ? `host: ${host}\n` : "") +
			`clock: {beats: 1}\nrecords: records/\n`;
		return planned({ program: text, manifest, ...shown }, true);
	}

	// catalog_edit: one exact edit of a domain's file on disk, by the SDK (comments and all; a .llp's
	// diagnostics checked); the program edited, the REPL serves it again
	type EditArgs = { domain: string; path: string; old_string: string; new_string: string; replace_all?: boolean };
	function planEdit(p: EditArgs): Plan {
		if (!NAME.test(p.domain)) throw new Error(`domain ${JSON.stringify(p.domain)}: lowercase letters, digits, _`);
		const root = writeRoot();
		const d = catalog.get(p.domain, root); // the loop's catalog has it (the SDK's error otherwise)
		const rel = `domains/${p.domain}/${posix.normalize(p.path)}`;
		if (!existsSync(join(d.dir, p.path)) && refused.get(resolve(root))?.has(rel))
			throw new Error(`${p.path} was never written: the person refused its proposal. Send it again through catalog_apply with only the fix; its gate shows what changed since`);
		const e: catalog.Edit = { path: p.path, old_string: p.old_string, new_string: p.new_string, replace_all: !!p.replace_all };
		const files = catalog.planEdit(p.domain, e, root, since(root));
		// the write is what the gate showed: a file that moved since (the same edit now gives another text) is refused
		const run = () => {
			const now = catalog.planEdit(p.domain, e, root);
			if (now.length !== files.length || now.some((f, i) => f.path !== files[i].path || f.text !== files[i].text))
				throw new Error(`${p.path} changed after the person approved the edit: nothing written; propose it again`);
			return catalog.edit(p.domain, e, root);
		};
		return { tool: "catalog_edit", domain: p.domain, root, reopen: !!d.program && resolve(d.dir, p.path) === resolve(d.program), files, run };
	}

	// catalog_take: the SDK's take from the loop's catalog into the person's — the
	// domain's own files, with a README of the run (the SDK's readme) when it has none
	function planTake(p: { domain: string }): Plan {
		if (!NAME.test(p.domain)) throw new Error(`domain ${JSON.stringify(p.domain)}: lowercase letters, digits, _`);
		const from = writeRoot();
		const into = takeRoot();
		catalog.get(p.domain, from); // the loop's catalog has it (the SDK's error otherwise)
		const o = { readmeFromRun: runDir() };
		return { tool: "catalog_take", domain: p.domain, root: into, reopen: false,
			files: catalog.planTake(p.domain, from, o, into, since(into)), run: () => catalog.take(p.domain, from, o, into) };
	}

	const plans = new Map<string, Plan>(); // toolCallId -> the plan the person approved

	// an approved plan's write, the REPL serving the program again when it was written
	async function execute(id: string, tool: Tool) {
		const pl = plans.get(id);
		plans.delete(id);
		if (!pl || pl.tool !== tool) throw new Error("not approved");
		if (pl.note) return { content: [{ type: "text" as const, text: pl.note + "." }], details: { written: [], note: pl.note } };
		const out = pl.run();
		remember(pl, true);
		const written: string[] = out.written;
		let after = "";
		if (pl.reopen) {
			// the program and its host as the catalog's loader names them
			const d = catalog.get(pl.domain, pl.root);
			const host = d.host && /\.py:/.test(d.host) ? join(dirname(d.program), d.host) : d.host;
			const failed = await reopen(d.program, host);
			after = failed
				? ` But metis cannot load the program it wrote: ${failed.slice(0, 600)}. The REPL still serves what it served before, its candidate kept: repair the text, formalize, check and apply again.`
				: ` The REPL now serves ${d.program}${host ? " with its host" : ""}.`;
		}
		return {
			content: [{ type: "text" as const, text: `applied: ${written.length ? written.join(", ") : "nothing (the catalog has it already)"}.${after}${pl.say ?? ""}` }],
			details: { written, fingerprint: out.fingerprint },
		};
	}

	pi.registerTool({
		executionMode: "sequential", // the tools share one process: one call at a time
		name: "catalog_apply",
		label: "apply to the catalog",
		description:
			"Write into the catalog (the person approves each write): what=program writes the REPL's gated candidate as the domain's program " +
			"(and a domain.yaml when there is none), then the REPL serves it; what=served writes the program the REPL serves, as it is " +
			"(a seed: its rules unchanged); what=extension writes the candidate as domains/<domain>/extensions/<name>.llp; " +
			"what=intents writes a first intent.yaml drafted from the domain's program (its cmd_* atoms and %% lines) and generates its files " +
			"(a world with no commands may get none); what=readme writes the domain's README.md: you give the title and the summary paragraph, " +
			"the SDK writes the rest from the files (where it came from, the program's header, how to run it, the intents). " +
			"A change to a file the catalog has already (a comment, a sentence, a value) is catalog_edit, not this.",
		parameters: Type.Object({
			domain: Type.String({ description: "the domain's name: lowercase letters, digits, _" }),
			what: Type.Union([Type.Literal("program"), Type.Literal("served"), Type.Literal("extension"), Type.Literal("intents"), Type.Literal("readme")]),
			name: Type.Optional(Type.String({ description: "what=extension: the extension's file name, without .llp" })),
			text: Type.Optional(Type.String({ description: "what=readme: the summary paragraph — what the program tells, each claim from the program (a rule, a header line, a --run output shown here)" })),
			title: Type.Optional(Type.String({ description: "what=readme: what the world is, for the title line `# <domain> — <title>`" })),
			display: Type.Optional(Type.String({ description: "what=served|program: domain.yaml's display, this world's short name, from its program (a package seed keeps its own)" })),
			line: Type.Optional(Type.String({ description: "what=served|program: domain.yaml's line, one line on what this world is (a package seed keeps its own)" })),
		}),
		async execute(id) {
			return execute(id, "catalog_apply");
		},
	});

	pi.registerTool({
		executionMode: "sequential",
		name: "catalog_edit",
		label: "edit a catalog file",
		description:
			"Edit one file of a domain in the catalog as it is on disk: old_string replaced by new_string, every other byte (comments " +
			"above all) kept. Never formalize or revise for a small change — a comment, a sentence of the README, a value in domain.yaml " +
			"or intent.yaml, one rule's text: this is the tool. The person approves the diff. old_string must match the file exactly " +
			"(whitespace and all) and occur once, unless replace_all; a .llp edit must add no diagnostic. path is relative to the " +
			"domain's directory: <domain>.llp, extensions/<name>.llp, README.md, intent.yaml, domain.yaml.",
		parameters: Type.Object({
			domain: Type.String({ description: "the domain's name: lowercase letters, digits, _" }),
			path: Type.String({ description: "the file, relative to the domain's directory (e.g. <domain>.llp, README.md)" }),
			old_string: Type.String({ description: "the exact text to replace (enough of it to occur once)" }),
			new_string: Type.String({ description: "the text to put in its place" }),
			replace_all: Type.Optional(Type.Boolean({ description: "replace every occurrence (default: exactly one)" })),
		}),
		async execute(id) {
			return execute(id, "catalog_edit");
		},
	});

	pi.registerTool({
		executionMode: "sequential",
		name: "catalog_take",
		label: "take into the person's catalog",
		description:
			"Only when the person asks: take a finished domain (its program, extensions, host, intents) from the loop's catalog into the " +
			"person's catalog, with a README of this run, and build its bundle. The person approves the diff; nothing is committed. " +
			"Refused when the person's catalog has the domain already.",
		parameters: Type.Object({ domain: Type.String({ description: "the domain's name: lowercase letters, digits, _" }) }),
		async execute(id) {
			const pl = plans.get(id);
			plans.delete(id);
			if (pl?.tool !== "catalog_take") throw new Error("not approved");
			const out = pl.run();
			remember(pl, true);
			let bundle: string;
			try {
				bundle = catalog.build(pl.domain, pl.root);
			} catch (e) {
				bundle = (e as Error).message;
			}
			return {
				content: [{ type: "text", text: `taken into ${pl.root}: ${out.written.join(", ")}. ${bundle}. Not committed: the person commits domains/${pl.domain} in that catalog.` }],
				details: { written: out.written, fingerprint: out.fingerprint, root: pl.root },
			};
		},
	});

	// the gate: every catalog_apply, catalog_edit and catalog_take waits for the person's confirmation in pi.
	// The whole diff: pi.sh runs the TUI in regular mode, so a long one stays in the scrollback. A file
	// refused before shows first what changed since that proposal, then its diff against the disk.
	pi.on("tool_call", async (event, ctx) => {
		const tool = event.toolName as Tool;
		if (tool !== "catalog_apply" && tool !== "catalog_edit" && tool !== "catalog_take") return undefined;
		let pl: Plan;
		try {
			pl = tool === "catalog_take" ? planTake(event.input as { domain: string })
				: tool === "catalog_edit" ? planEdit(event.input as EditArgs)
				: await plan(event.input as ApplyArgs);
		} catch (e) {
			return { block: true, reason: (e as Error).message };
		}
		if (pl.note) {
			plans.set(event.toolCallId, pl); // nothing to write: no question for the person
			return undefined;
		}
		if (!ctx.hasUI) return { block: true, reason: "no person to approve the write (no UI)" };
		const mark = (f: catalog.Planned) =>
			`${f.path}${f.new ? " (new)" : ""}${f.since_diff === undefined ? "" : f.since_diff ? " (changed since you refused it)" : " (as you refused it)"}`;
		const what = pl.files.map(mark).join(", ") || "nothing changes";
		const body = pl.files.map((f) =>
			f.since_diff
				? `── ${f.path}: since the proposal you refused ──\n${f.since_diff}── ${f.path}: against the file on disk ──\n${f.diff}`
				: f.diff).join("").replace(/\n$/, "");
		const verb = pl.tool === "catalog_take" ? "Take into" : pl.tool === "catalog_edit" ? "Edit in" : "Apply to";
		const ok = await ctx.ui.confirm(`${verb} the catalog ${pl.root}: ${what}?`, body);
		if (!ok) remember(pl, false); // an approval forgets the refused text once its write is done (execute)
		if (!ok) return { block: true, reason: "the person did not approve this write" };
		plans.set(event.toolCallId, pl);
		return undefined;
	});

	// a package seed's program is served with its host (its weight ports, its world), as the seed catalog names it
	function seedHost(llp: string | null): string | null {
		if (!llp) return null;
		try {
			const s = JSON.parse(readFileSync(join(runDir(), "seed.json"), "utf8"));
			if (!s.package) return null;
			const d = catalog.get(s.name, join(runDir(), "seed"));
			if (resolve(d.program) !== resolve(llp)) return null;
			return d.host && /\.py:/.test(d.host) ? join(dirname(d.program), d.host) : d.host ?? null;
		} catch {
			return null;
		}
	}

	pi.on("session_start", async (_event, ctx) => {
		const llp = process.env.METIS_LOOP_LLP || null;
		open(llp, seedHost(llp));
		const r = await registerVerbs();
		if (r.undescribed.length && ctx.hasUI)
			ctx.ui.notify(`metis-repl: ${r.ops} verbs; ${r.undescribed.length} without a description on the wire (finding: metispy): ${r.undescribed.join(" ")}`, "warning");
	});

	pi.on("session_shutdown", () => {
		repl?.close();
		repl = null;
	});

	pi.registerCommand("repl-served", {
		description: "what the metis REPL serves",
		handler: async (_a, ctx) => ctx.ui.notify(served ?? "a blank world", "info"),
	});
}
