// metis-domain — a domain agent as pi tools (docs/LOOP-AGENT.md; agentic-loop
// s-3ddb3e87). One `python -m metis_agent.domain_agent` process per opened
// domain (its JSON lines: py/metis_agent/domain_agent.py's docstring), the
// upper half's seat as orch_emu drives it. The tools are generated from the
// interfaces' own declarations:
//   J  intent_<verb>  one per verb of the domain's intent.yaml (its meaning as
//                     the description), async: `accepted` now, the outcome
//                     on a later beat
//   T  domain_<tool>  one per tool of metispy's REPL API (`metis --tools-json`)
//                     the domain agent serves (served_by repl | watch | agent)
//   +  domain_clock   the loop owns time ({"clock": "beat"|"step"})
// Unasked lines (event, quiescence, surprise) and the intents' late outcomes
// come with the clock; a surprise also enters the loop as a message.
//
// Environment (loop.sh sets them):
//   METIS_LOOP_AGENT_PY   metis-agent/py's python (the domain agent's venv)
//   METIS_LOOP_AGENT_DIR  metis-agent/py (the process's working directory)
//   METIS_LOOP_METIS      metispy's `metis` (for --tools-json)
//   METIS_CATALOG         the catalog the domains come from (a scratch copy for trials)
//   METIS_LOOP_SDK_PY     a python with the loop SDK: a domain's intents come through its catalog CLI
//   METIS_LOOP_RECORDS    where the domain agent sinks its records
import { execFileSync } from "node:child_process";
import { Type, type TSchema } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { cap, JsonlChild, type Line } from "./lib/jsonl.ts";
import { catalog } from "./lib/catalog.ts";

const SERVED = new Set(["repl", "watch", "agent"]);
const NAME = /^[a-z][a-z0-9_]*$/;

function schema(p: Record<string, any> | null, domain: string): TSchema {
	// metispy's Gemma-style declaration -> a JSON schema (lowercase types; enum_from filled)
	const props: Record<string, TSchema> = {};
	for (const [k, v] of Object.entries(p?.properties ?? {})) {
		const opts: Record<string, unknown> = { description: v.description };
		if (v.enum_from) props[k] = Type.Union([Type.Literal(domain)], opts);
		else props[k] = v.type === "INTEGER" ? Type.Integer(opts) : v.type === "NUMBER" ? Type.Number(opts) : Type.String(opts);
		if (!(p?.required ?? []).includes(k)) props[k] = Type.Optional(props[k]);
	}
	return Type.Object(props);
}

export default function (pi: ExtensionAPI) {
	let agent: JsonlChild | null = null;
	let domain: string | null = null;
	const registered = new Set<string>();
	let seq = 0;
	const env = () => ({ ...process.env, CUDA_VISIBLE_DEVICES: process.env.METIS_LOOP_CUDA ?? process.env.CUDA_VISIBLE_DEVICES });

	function surprise(l: Line) {
		pi.sendMessage(
			{ customType: "metis-domain-signal", content: `The domain ${l.domain ?? domain} signals a surprise: ${JSON.stringify(l)}`, display: true },
			{ deliverAs: "steer", triggerTurn: true },
		);
	}

	function render(l: Line): string | null {
		if ("ack" in l) return null;
		if (l.clock) return `clock: beat ${l.beat}${l.over ? " (the day is over)" : ""}`;
		const k = l.kind ?? l.signal;
		if (k === "read") return String(l.output ?? "");
		if (k === "result") return `result ${l.id ?? ""} ${l.status}${l.reason ? ` (${l.reason})` : ""}: ${l.text ?? ""}`.trim();
		if (k === "consult") return `consult: ${l.answer_kind} ${l.text ?? ""}`;
		if (k === "surprise") return `SURPRISE record ${l.record}: ${JSON.stringify(l.difference)}${l.cards ? ` cards ${JSON.stringify(l.cards)}` : ""}`;
		if (k === "quiescence")
			// unsettled: the beat stopped at the domain agent's step cap, these rules still firing
			return `${l.unsettled ? "UNSETTLED " : ""}quiescence${l.episode_over || l.over ? " (episode over)" : ""}${l.text ? `: ${l.text}` : ""}` +
				(l.unsettled ? ` unsettled ${JSON.stringify(l.unsettled)}` : "");
		if (k === "event") return `event ${l.ref?.event ?? l.name ?? ""}${l.ops ? ` ${JSON.stringify(l.ops)}` : ""}${l.text ? `: ${l.text}` : ""}`;
		return JSON.stringify(l);
	}

	// the lines of one call in words; the same event said again (a rule that
	// keeps firing: a capped beat sends one per step) is one line with its
	// count and the beats it came on, where it first came
	function summary(lines: Line[]): string {
		const rows: { text: string; n: number; first?: number; last?: number }[] = [];
		const at = new Map<string, number>();
		for (const l of lines) {
			const text = render(l);
			if (!text) continue;
			const beat = typeof l.ref?.beat === "number" ? (l.ref.beat as number) : undefined;
			const i = (l.kind ?? l.signal) === "event" ? at.get(text) : undefined;
			if (i !== undefined) {
				rows[i].n++;
				rows[i].last = beat ?? rows[i].last;
				continue;
			}
			if ((l.kind ?? l.signal) === "event") at.set(text, rows.length);
			rows.push({ text, n: 1, first: beat, last: beat });
		}
		return rows
			.map((r) => {
				if (r.n === 1) return r.text;
				const when = r.first === undefined ? "" : r.first === r.last ? `, beat ${r.first}` : `, beats ${r.first}–${r.last}`;
				return r.text.replace(/^(event [^\s:]*)/, `$1 fired ×${r.n}${when}`);
			})
			.join("\n");
	}

	async function line(l: Line, until: (x: Line) => boolean): Promise<Line[]> {
		if (!agent) throw new Error("no domain is open: call domain_open first");
		const out = await agent.request(l, until);
		for (const x of out) if ((x.kind ?? x.signal) === "surprise") surprise(x);
		return out;
	}

	function intentMaterial(d: string): { verbs: { verb: string; meaning: string }[]; slots: Record<string, unknown> } {
		// intent.yaml itself, read by the loop SDK's catalog CLI (none: no verbs)
		const y = catalog(["intents", d, "--spec"]).spec ?? {};
		return { verbs: y.verbs ?? [], slots: y.slots ?? {} };
	}

	function registerTools(d: string) {
		const decl = JSON.parse(execFileSync(process.env.METIS_LOOP_METIS || "metis", ["--tools-json"], { encoding: "utf8" }));
		for (const t of decl.tools as any[]) {
			if (!SERVED.has(t.served_by) || registered.has(`domain_${t.name}`)) continue;
			registered.add(`domain_${t.name}`);
			pi.registerTool({
			executionMode: "sequential", // the tools share one process: one call at a time
				name: `domain_${t.name}`,
				label: `domain ${t.name}`,
				description: `${t.description} (the domain agent; answers: ${(t.final ?? []).join(" · ")})`,
				parameters: schema(t.parameters, d),
				async execute(_id, params: Record<string, unknown>) {
					const { domain: _d, ...args } = params;
					const id = `t${++seq}`;
					const out = await line({ tool: t.name, args, id }, (x) => x.ack !== undefined && x.id === id);
					return { content: [{ type: "text", text: cap(summary(out)) }], details: { tool: t.name, lines: out } };
				},
			});
		}
		const im = intentMaterial(d);
		const slots = Object.keys(im.slots);
		for (const v of im.verbs) {
			const name = `intent_${String(v.verb).toLowerCase()}`;
			if (!NAME.test(name) || registered.has(name)) continue;
			registered.add(name);
			pi.registerTool({
			executionMode: "sequential", // the tools share one process: one call at a time
				name,
				label: `intent ${v.verb}`,
				description: `Say ${v.verb} to the domain (async: accepted now, the outcome comes with the clock): ${v.meaning}`,
				parameters: Type.Object({
					args: Type.Optional(Type.Record(Type.String(), Type.String(), { description: slots.length ? `the verb's slots: ${slots.join(", ")}` : "none" })),
				}),
				async execute(_id, params) {
					const id = `i${++seq}`;
					const out = await line({ id, domain: d, verb: v.verb, args: params.args ?? {} }, (x) => x.ack !== undefined && x.id === id);
					return { content: [{ type: "text", text: cap(summary(out)) }], details: { verb: v.verb, lines: out } };
				},
			});
		}
		return im.verbs.length;
	}

	pi.registerTool({
			executionMode: "sequential", // the tools share one process: one call at a time
		name: "domain_open",
		label: "open a domain",
		description:
			"Start the domain agent of a catalog domain (its program, host and intents from the catalog), the loop owning its clock. " +
			"Opening again restarts it on the catalog's files as they are now (after an apply). Its intent and REPL tools appear when it is open.",
		parameters: Type.Object({ domain: Type.String({ description: "the catalog domain's name" }) }),
		async execute(_id, params) {
			if (!NAME.test(params.domain)) throw new Error(`domain ${JSON.stringify(params.domain)}: lowercase letters, digits, _`);
			agent?.close();
			const py = process.env.METIS_LOOP_AGENT_PY || "python3";
			const args = ["-m", "metis_agent.domain_agent", "--domain", params.domain, "--case", "replay", "--consult", "template"];
			if (process.env.METIS_LOOP_RECORDS) args.push("--records", process.env.METIS_LOOP_RECORDS);
			agent = new JsonlChild(py, args, { cwd: process.env.METIS_LOOP_AGENT_DIR, env: env() }, (l) => {
				if ((l.kind ?? l.signal) === "surprise") surprise(l);
			});
			domain = params.domain;
			const ready = await agent.request(null, (x) => x.clock === "ready", 300_000);
			const n = registerTools(params.domain);
			return {
				content: [{ type: "text", text: `${params.domain} is open at beat ${ready[ready.length - 1].beat}; ${n} intent verb(s) and the REPL API's tools are available; advance time with domain_clock.` }],
				details: { domain: params.domain },
			};
		},
	});

	pi.registerTool({
			executionMode: "sequential", // the tools share one process: one call at a time
		name: "domain_clock",
		label: "the domain's clock",
		description: "Advance the open domain's time: beat = one host tick and the runtime until it would tick again (the world moves, outcomes and signals arrive); n beats at once (default 1).",
		parameters: Type.Object({ n: Type.Optional(Type.Integer({ description: "how many beats (1-50)", minimum: 1, maximum: 50 })) }),
		async execute(_id, params) {
			const n = Math.min(50, Math.max(1, params.n ?? 1));
			const all: Line[] = [];
			for (let i = 0; i < n; i++) {
				const out = await line({ clock: "beat" }, (x) => x.clock === "beat");
				all.push(...out);
				if (out[out.length - 1].over) break;
			}
			return { content: [{ type: "text", text: cap(summary(all)) }], details: { lines: all } };
		},
	});

	pi.on("session_shutdown", () => {
		agent?.close();
		agent = null;
	});
}
