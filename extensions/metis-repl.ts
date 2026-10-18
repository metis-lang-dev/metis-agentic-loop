// metis-repl — the metis REPL as pi tools (docs/LOOP-AGENT.md; agentic-loop
// s-3ddb3e87). One `metis --json` process per pi session (the REPL's JSON-lines
// wire, metis.loop.wire): the tools are generated from the wire's own `help`
// — its verb list and the descriptions it declares; a verb it declares
// without a description gets no words from here (a finding against metispy,
// marked in the tool's description). No logic of its own, except the one
// write the wire never makes: catalog_apply, behind pi's tool_call gate (the
// person approves every write into the catalog), and catalog_take, which takes a
// finished domain from the loop's catalog into the person's, behind the same gate.
//
// Environment (loop.sh sets them):
//   METIS_LOOP_METIS   the metis console script (metispy's `metis`)
//   METIS_CATALOG      the catalog catalog_apply writes into (a scratch copy for trials)
//   METIS_LOOP_SDK_PY  a python with the loop SDK: catalog_apply goes through its catalog CLI
//   METIS_CONFIG       the kernel's dot file ([llm]: formalize's endpoint)
//   METIS_LOOP_LLP     optional: the program the REPL starts on (else a blank world)
//   METIS_LOOP_TAKE_INTO the catalog catalog_take takes a domain into (loop.sh --scratch: metis-catalog)
//   METIS_LOOP_RECORDS the run's records (formalize-calls.jsonl, for the taken domain's README)
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Type } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { cap, JsonlChild, type Line } from "./lib/jsonl.ts";
import { catalog, type Planned, takeRoot, writeRoot } from "./lib/catalog.ts";

const NO_WORDS = "(the REPL's wire declares no description for this verb — finding: metispy)";
const ARG = Type.Object({
	arg: Type.Optional(Type.String({ description: "everything after the verb on the REPL line, as a person types it (empty for the bare verb)" })),
});
const NAME = /^[a-z][a-z0-9_]*$/;
const TAKE_README = join(dirname(fileURLToPath(import.meta.url)), "lib", "take_readme.py");

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
	// through the loop SDK's catalog CLI (lib/catalog.ts): the plan is its
	// dry run (each file's diff, what the person approves), the write its
	// apply with the same text — domain.yaml checked by the catalog's loader,
	// the intent files generated, never a commit

	// cmd: the SDK command the write runs (its plan: the same with --dry-run); root: the catalog it writes
	type Plan = { domain: string; cmd: string[]; input: string; files: Planned[]; reopen: boolean; root: string; take?: boolean };

	async function plan(p: { domain: string; what: string; name?: string }): Promise<Plan> {
		if (!NAME.test(p.domain)) throw new Error(`domain ${JSON.stringify(p.domain)}: lowercase letters, digits, _`);
		writeRoot();
		const planned = (args: string[], input: string, reopen = false): Plan => ({
			domain: p.domain, cmd: ["apply", p.domain, ...args], input, reopen, root: writeRoot(),
			files: catalog(["apply", p.domain, ...args, "--dry-run"], input).files,
		});
		if (p.what === "intents") {
			// a first intent.yaml drafted from the program; apply names it in domain.yaml (intent: {spec})
			return planned(["--intents", "-"], catalog(["intents", p.domain, "--skeleton"]).skeleton);
		}
		const st = await op("show");
		if (!st.candidate) throw new Error("no candidate in the REPL: formalize (or mine + formalize) first");
		if (!st.gated) throw new Error("the candidate has not passed the gate: run repl_gate (an extension) or repl_revise (a program) until it does");
		let cand = String((await op("show", "llp")).llp ?? "");
		if (!cand.endsWith("\n")) cand += "\n";
		if (p.what === "program") {
			let known = true;
			try {
				catalog(["get", p.domain]);
			} catch {
				known = false;
			}
			if (known) return planned(["--program", "-"], cand, true);
			// a new domain: its manifest, the host beside the program when the world brought one
			const host = existsSync(join(writeRoot(), "domains", p.domain, `${p.domain}_host.py`)) ? `${p.domain}_host.py:make` : null;
			const manifest =
				`# written by the agentic loop's catalog_apply (docs/LOOP-AGENT.md)\nprogram: ${p.domain}.llp\n` +
				(host ? `host: ${host}\n` : "") +
				`clock: {beats: 1}\nrecords: records/\n`;
			return planned(["--program", "-", "--manifest", JSON.stringify(manifest)], cand, true);
		}
		if (p.what === "extension") {
			const name = p.name && NAME.test(p.name) ? p.name : "";
			if (!name) throw new Error("an extension needs a name (lowercase): it is written to domains/<domain>/extensions/<name>.llp");
			return planned(["--extension", `${name}=-`], cand);
		}
		throw new Error(`what: program | extension | intents, not ${JSON.stringify(p.what)}`);
	}

	// catalog_take: the SDK's `take` from the loop's catalog into the person's —
	// the domain's own files, with a README of the run when it has none
	function planTake(p: { domain: string }): Plan {
		if (!NAME.test(p.domain)) throw new Error(`domain ${JSON.stringify(p.domain)}: lowercase letters, digits, _`);
		const from = writeRoot();
		const into = takeRoot();
		catalog(["get", p.domain]); // the loop's catalog has it (the SDK's error otherwise)
		let readme = "";
		if (!existsSync(join(from, "domains", p.domain, "README.md"))) {
			const calls = process.env.METIS_LOOP_RECORDS ? join(process.env.METIS_LOOP_RECORDS, "formalize-calls.jsonl") : "";
			readme = execFileSync(process.env.METIS_LOOP_SDK_PY || "python3",
				[TAKE_README, from, p.domain, calls, basename(dirname(from))], { encoding: "utf8" });
		}
		const cmd = ["take", p.domain, "--from", from, ...(readme ? ["--readme", "-"] : [])];
		return { domain: p.domain, cmd, input: readme, reopen: false, root: into, take: true,
			files: catalog([...cmd, "--dry-run"], readme, into).files };
	}

	const plans = new Map<string, Plan>(); // toolCallId -> the plan the person approved

	pi.registerTool({
			executionMode: "sequential", // the tools share one process: one call at a time
		name: "catalog_apply",
		label: "apply to the catalog",
		description:
			"Write into the catalog (the person approves each write): what=program writes the REPL's gated candidate as the domain's program " +
			"(and a domain.yaml when there is none), then the REPL serves it; what=extension writes it as domains/<domain>/extensions/<name>.llp; " +
			"what=intents writes a first intent.yaml drafted from the domain's program (its cmd_* atoms and %% lines) and generates its files.",
		parameters: Type.Object({
			domain: Type.String({ description: "the domain's name: lowercase letters, digits, _" }),
			what: Type.Union([Type.Literal("program"), Type.Literal("extension"), Type.Literal("intents")]),
			name: Type.Optional(Type.String({ description: "what=extension: the extension's file name, without .llp" })),
		}),
		async execute(id) {
			const pl = plans.get(id);
			plans.delete(id);
			if (!pl || pl.take) throw new Error("not approved");
			const out = catalog(pl.cmd, pl.input);
			const written: string[] = out.written;
			let after = "";
			if (pl.reopen) {
				// the program and its host as the catalog's loader names them
				const d = catalog(["get", pl.domain]);
				const host = d.host && /\.py:/.test(d.host) ? join(dirname(d.program), d.host) : d.host;
				const failed = await reopen(d.program, host);
				after = failed
					? ` But metis cannot load the program it wrote: ${failed.slice(0, 600)}. The REPL still serves what it served before, its candidate kept: repair the text, formalize, check and apply again.`
					: ` The REPL now serves ${d.program}${host ? " with its host" : ""}.`;
			}
			return {
				content: [{ type: "text", text: `applied: ${written.length ? written.join(", ") : "nothing (the catalog has it already)"}.${after}` }],
				details: { written, fingerprint: out.fingerprint },
			};
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
			if (!pl?.take) throw new Error("not approved");
			const out = catalog(pl.cmd, pl.input, pl.root);
			let bundle: string;
			try {
				bundle = execFileSync(process.env.METIS_LOOP_SDK_PY || "python3", ["-m", "metis.kernel.artifact", pl.domain], {
					cwd: pl.root, env: { ...process.env, METIS_CATALOG: pl.root }, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
				}).trim();
			} catch (e: any) {
				bundle = `the bundle did not build: ${String(e.stderr || e.message).trim().slice(-400)}`;
			}
			return {
				content: [{ type: "text", text: `taken into ${pl.root}: ${out.written.join(", ")}. ${bundle}. Not committed: the person commits domains/${pl.domain} in that catalog.` }],
				details: { written: out.written, fingerprint: out.fingerprint, root: pl.root },
			};
		},
	});

	// the gate: every catalog_apply and catalog_take waits for the person's confirmation in pi
	pi.on("tool_call", async (event, ctx) => {
		if (event.toolName !== "catalog_apply" && event.toolName !== "catalog_take") return undefined;
		let pl: Plan;
		try {
			pl = event.toolName === "catalog_take"
				? planTake(event.input as { domain: string })
				: await plan(event.input as { domain: string; what: string; name?: string });
		} catch (e) {
			return { block: true, reason: (e as Error).message };
		}
		if (!ctx.hasUI) return { block: true, reason: "no person to approve the write (no UI)" };
		const what = pl.files.map((f) => `${f.path}${f.new ? " (new)" : ""}`).join(", ") || "nothing changes";
		const diff = pl.files.map((f) => f.diff).join("").split("\n");
		const ok = await ctx.ui.confirm(
			`Apply to the catalog ${pl.root}: ${what}?`,
			`${diff.slice(0, 60).join("\n")}${diff.length > 60 ? "\n…" : ""}`,
		);
		if (!ok) return { block: true, reason: "the person did not approve this write" };
		plans.set(event.toolCallId, pl);
		return undefined;
	});

	pi.on("session_start", async (_event, ctx) => {
		const llp = process.env.METIS_LOOP_LLP || null;
		open(llp, null);
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
