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
//   +  domain_ports   the host's world ports ({"ports"}): an RDDL world's gym, its
//                     observed and derived atoms, its actions and weight ports
//   +  domain_world   world lines to the host ({"world": [...]}): +atom / -atom, …
//   +  domain_episodes N seeded episodes measured ({"reset": {"seed"}}, scored beats
//                     to the episode's end): outcomes, likelihood, surprises, mismatches
//                     (rddl-worlds s-242c7c3f: a world without intents is exercised so)
// Unasked lines (event, quiescence, surprise) and the intents' late outcomes
// come with the clock; a surprise also enters the loop as a message.
//
// Environment (loop.sh sets them):
//   METIS_LOOP_AGENT_PY   metis-agent/py's python (the domain agent's venv)
//   METIS_LOOP_AGENT_DIR  metis-agent/py (the process's working directory)
//   METIS_LOOP_METIS      metispy's `metis` (for --tools-json)
//   METIS_CATALOG         the catalog the domains come from (loop.sh: the directory it starts in)
//   METIS_LOOP_SDK_PY     a python with the loop SDK: a domain's intents come through its catalog (./sdk/catalog.ts, its TypeScript face)
//   METIS_LOOP_RECORDS    where the domain agent sinks its records
import { execFileSync } from "node:child_process";
import { Type, type TSchema } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { cap, JsonlChild, type Line } from "./lib/jsonl.ts";
import * as catalog from "./sdk/catalog.ts";

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
		// intent.yaml itself, read by the loop SDK's catalog (none: no verbs)
		const y = catalog.intents(d, { spec: true }).spec ?? {};
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

	// ---- the world faces (rddl-worlds s-242c7c3f): a world without intents ----

	function ports(l: Line): string {
		const h = l.host ?? null;
		const rows: string[] = [];
		if (h?.gym) rows.push(`gym: ${Object.entries(h.gym).map(([k, v]) => `${k} ${JSON.stringify(v)}`).join(", ")}`);
		if (h?.observed) rows.push(`observed atoms (${h.observed.length}): ${h.observed.join(" ")}`);
		if (h?.derived?.length) rows.push(`derived atoms: ${h.derived.join(" ")}`);
		if (h?.actions?.length) rows.push(`actions: ${h.actions.join(" ")}`);
		if (h?.weights?.length) rows.push(`weight ports the host binds: ${h.weights.join(" ")}`);
		if (l.pairs?.length) rows.push(`pairs: ${JSON.stringify(l.pairs)}${l.held?.length ? `; held now: ${l.held.join(" ")}` : ""}`);
		if (l.reports && Object.keys(l.reports).length) rows.push(`reports: ${Object.keys(l.reports).join(" ")}`);
		rows.push(l.world ? "world lines: taken (domain_world)" : "world lines: this host takes none");
		return rows.join("\n");
	}

	pi.registerTool({
		executionMode: "sequential",
		name: "domain_ports",
		label: "the domain's ports",
		description:
			"The open domain's world ports, read from its host: an RDDL world's gym (problem, instance, seed, step, horizon, done, reward), " +
			"the atoms the host observes and derives, the actions it sends the gym, the weight ports it binds; for another world its pairs and reports. " +
			"Read it before domain_world, so no name is guessed.",
		parameters: Type.Object({}),
		async execute() {
			const id = `p${++seq}`;
			const out = await line({ ports: {}, id }, (x) => x.ack !== undefined && x.id === id);
			const p = out.find((x) => (x.kind ?? x.signal) === "ports");
			const err = out.find((x) => x.error);
			return { content: [{ type: "text", text: cap(p ? ports(p) : `refused: ${err?.error ?? JSON.stringify(out)}`) }], details: { lines: out } };
		},
	});

	pi.registerTool({
		executionMode: "sequential",
		name: "domain_world",
		label: "world lines to the domain",
		description:
			"Set the open domain's world through its host, for a scenario: lines as domain_ports names them — `+atom` / `-atom` (a state fluent), " +
			"`nonfluent KEY V`, `seed N`, `reset [N]` for an RDDL world. The world changes; the program does not. Then advance time with domain_clock.",
		parameters: Type.Object({ lines: Type.Array(Type.String(), { description: "the world lines, e.g. [\"+at(x6_y12)\", \"-at(x21_y12)\"]", minItems: 1 }) }),
		async execute(_id, params) {
			const id = `w${++seq}`;
			const out = await line({ world: params.lines, id }, (x) => x.ack !== undefined && x.id === id);
			const err = out.find((x) => x.error);
			return {
				content: [{ type: "text", text: err ? `refused: ${err.error}` : `world: ${params.lines.join(", ")} — taken; it reaches the program on the next beat (domain_clock).` }],
				details: { lines: out },
			};
		},
	});

	type Episode = {
		seed: number; beats: number; over: boolean; loglik: number | null; scored: number; unscored: number; zero: number; rare: number;
		surprises: number; reward?: number; step?: number; done?: boolean; counts: Record<string, number>;
		idle: { scored: number; loglik: number; zero: number; sampledZero: number }; // beats with no action the program sent, in a world that maps actions
		// the watch's pricing of the beat's reading (a lockstep or followed world, rddl-watch s-cfe94dca: every score says its tier):
		// exact, or sampled (n seeded runs, the 95% half-width ci). A sampled zero is no run of n reaching the reading: below the
		// tier's resolution, not impossible, so it never makes the episode zero-probability (only an exact zero does)
		read: { exact: number; sampled: number; loglik: number; nonzero: number; exactZero: number; sampledZero: number; n?: number; ci: number };
	};
	type Low = { seed: number; beat: number; p: number; what: string };
	const RARE = 0.05;
	// the 95% Wilson upper bound of a sampled zero, z²/(n + z²): what "no run of n reached it" bounds
	const upper = (n: number) => 1.96 ** 2 / (n + 1.96 ** 2);

	// N episodes, each a reset with its seed (the program's sampler and the host's gym alike), the world lines,
	// then scored beats to the episode's end: the measure, not the exercise — its surprises are counted, not steered in.
	// The likelihood: per action the program sent, P(the world's answer | that action) (the domain agent's `outcomes`:
	// an RDDL world); for a host with no actions, per beat, P(the host's reading | the beat's start). A beat of an
	// action world in which the program sent no action (every beat of an observing world, where the host acts; nav
	// once the robot is gone) is scored by its reading, apart: its p = 0 makes the episode impossible as well, unless
	// the p is the sampled tier's (a zero there is below its resolution: rare, counted apart, never impossible)
	async function episodes(n: number, seed0: number, world: string[] | undefined, maxBeats: number) {
		if (!agent) throw new Error("no domain is open: call domain_open first");
		const eps: Episode[] = [];
		const low: Low[] = [];
		const mism = new Map<string, { beats: number; episodes: Set<number>; more: number; less: number }>();
		let measure: "outcome" | "beat" | null = null;
		for (let k = 0; k < n; k++) {
			const seed = seed0 + k;
			// the case domain_open started (replay): a reset without one would rebuild another
			const r = await agent.request({ reset: { seed, case: "replay" }, id: `r${++seq}` }, (x) => x.ack !== undefined);
			const bad = r.find((x) => x.error);
			if (bad) throw new Error(`episode seed ${seed}: the reset was refused: ${bad.error}`);
			if (world?.length) {
				const w = await agent.request({ world, id: `w${++seq}` }, (x) => x.ack !== undefined);
				const e = w.find((x) => x.error);
				if (e) throw new Error(`episode seed ${seed}: the world lines were refused: ${e.error}`);
			}
			const ep: Episode = { seed, beats: 0, over: false, loglik: 0, scored: 0, unscored: 0, zero: 0, rare: 0, surprises: 0, counts: {},
				idle: { scored: 0, loglik: 0, zero: 0, sampledZero: 0 },
				read: { exact: 0, sampled: 0, loglik: 0, nonzero: 0, exactZero: 0, sampledZero: 0, ci: 0 } };
			const below = (sc: any) => `below the sampled tier's resolution: no run of ${sc.n} reached it (seed ${sc.seed}; p < ${upper(sc.n).toPrecision(2)} at 95%)`;
			const score = (p: number | null | undefined, beat: number, what: string, sc?: any) => {
				if (typeof p !== "number") return void ep.unscored++;
				if (p <= 0 && sc?.tier === "sampled") {         // counted in the tier's row (read), not as a probability
					ep.rare++;
					return void low.push({ seed, beat, p, what: `${what}, ${below(sc)}` });
				}
				ep.scored++;
				if (p <= 0) ep.zero++;
				else if (ep.loglik !== null) ep.loglik += Math.log(p);
				if (p < RARE) ep.rare++;
				if (p < 1) low.push({ seed, beat, p, what });
			};
			const idle = (p: number | null | undefined, beat: number, what: string, sc?: any) => {
				if (typeof p !== "number") return;
				ep.idle.scored++;
				if (p <= 0 && sc?.tier === "sampled") {
					ep.idle.sampledZero++;
					what = `${what}, ${below(sc)}`;
				} else if (p <= 0) {
					ep.idle.zero++;
					ep.zero++;
				} else ep.idle.loglik += Math.log(p);
				if (p < RARE) ep.rare++;
				if (p < 1) low.push({ seed, beat, p, what });
			};
			const read = (sc: any) => {
				if (sc.tier !== "exact" && sc.tier !== "sampled") return;
				const r = ep.read, p = sc.likelihood;
				r[sc.tier as "exact" | "sampled"]++;
				if (sc.tier === "sampled") {
					r.n = sc.n;
					r.ci = Math.max(r.ci, sc.ci ?? 0);
				}
				if (typeof p !== "number") return;
				if (p > 0) {
					r.loglik += Math.log(p);
					r.nonzero++;
				} else if (sc.tier === "sampled") r.sampledZero++;
				else r.exactZero++;
			};
			for (let b = 0; b < maxBeats; b++) {
				const out = await agent.request({ clock: "beat", score: true }, (x) => x.clock === "beat");
				const c = out[out.length - 1];
				ep.beats++;
				ep.surprises += out.filter((x) => (x.kind ?? x.signal) === "surprise").length;
				const sc = c.score;
				if (sc) {
					ep.counts = sc.counts ?? ep.counts;
					read(sc);
					if (Array.isArray(sc.outcomes) && !sc.outcomes.length) {
						measure = measure ?? "outcome";
						idle(sc.likelihood, c.beat, `a beat with no action the program sent: the host's reading${sc.mismatch?.length ? ` (against the program's state: ${JSON.stringify(sc.mismatch)})` : ""}`, sc);
					} else if (Array.isArray(sc.outcomes)) {
						measure = "outcome";
						for (const o of sc.outcomes)
							score(o.p, c.beat, `the program drew ${o.event}; the world answered ${(o.answered_by ?? []).join(" or ") || "none of its alternatives"} (${Object.keys(o.action ?? {}).join(" ")})`);
					} else {
						measure = measure ?? "beat";
						score(sc.likelihood, c.beat, `the host's reading${sc.mismatch?.length ? ` (against the program's state: ${JSON.stringify(sc.mismatch)})` : ""}`, sc);
					}
					for (const d of sc.mismatch ?? [])
						for (const [atom, v] of Object.entries(d as Record<string, number>)) {
							const m = mism.get(atom) ?? { beats: 0, episodes: new Set<number>(), more: 0, less: 0 };
							m.beats++;
							m.episodes.add(seed);
							v > 0 ? m.more++ : m.less++;
							mism.set(atom, m);
						}
				} else ep.unscored++;
				if (c.over) {
					ep.over = true;
					break;
				}
			}
			if (ep.zero) ep.loglik = null; // an impossible answer: the program gives the episode zero probability
			const pr = await agent.request({ ports: {}, id: `p${++seq}` }, (x) => x.ack !== undefined);
			const gym = pr.find((x) => (x.kind ?? x.signal) === "ports")?.host?.gym;
			if (gym) Object.assign(ep, { reward: gym.reward, step: gym.step, done: gym.done });
			eps.push(ep);
		}
		return { eps, low, mism, measure };
	}

	function episodesText(n: number, seed0: number, r: Awaited<ReturnType<typeof episodes>>): string {
		const { eps, low, mism, measure } = r;
		const fin = eps.map((e) => e.loglik).filter((x): x is number => x !== null);
		const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
		const f = (x: number) => x.toFixed(3);
		const rows = [`${n} episode(s), seeds ${seed0}–${seed0 + n - 1}; each a reset with its seed, then scored beats to its end.`];
		// outcomes: the reported atoms at each episode's end, and the host's gym
		const atoms = [...new Set(eps.flatMap((e) => Object.keys(e.counts)))].sort();
		for (const a of atoms) {
			const by = new Map<number, number>();
			for (const e of eps) by.set(e.counts[a] ?? 0, (by.get(e.counts[a] ?? 0) ?? 0) + 1);
			rows.push(`outcome ${a}: ${[...by.entries()].sort((x, y) => x[0] - y[0]).map(([v, k]) => `${v} in ${k}/${eps.length}`).join(", ")}`);
		}
		const rw = eps.map((e) => e.reward).filter((x): x is number => typeof x === "number");
		if (rw.length) rows.push(`gym reward: mean ${f(sum(rw) / rw.length)}, min ${f(Math.min(...rw))}, max ${f(Math.max(...rw))}; episodes done ${eps.filter((e) => e.done).length}/${eps.length}`);
		const notOver = eps.filter((e) => !e.over).length;
		if (notOver) rows.push(`${notOver} episode(s) did not end within the beat cap`);
		// the program's likelihood of what the world did
		const scored = sum(eps.map((e) => e.scored)), unscored = sum(eps.map((e) => e.unscored));
		const what = measure === "outcome" ? "P(the world's answer | the action the program sent), per action" +
			(scored ? "" : " (the program sent none: the host acts, an observing world)")
			: measure === "beat" ? "P(the host's reading | the beat's start), per beat (the host maps no actions)" : "nothing scored";
		rows.push(`likelihood under the program, ${what}: ${scored} scored` + (unscored ? `, ${unscored} unscored` : "") +
			(scored ? `; mean log per scored ${f(sum(fin) / Math.max(1, sum(eps.filter((e) => e.loglik !== null).map((e) => e.scored))))}` : "") +
			(fin.length ? `; per episode (sum of logs) mean ${f(sum(fin) / fin.length)}, min ${f(Math.min(...fin))}, max ${f(Math.max(...fin))}` : "") +
			`; zero-probability episodes ${eps.filter((e) => e.loglik === null).length}/${eps.length}`);
		const idleN = sum(eps.map((e) => e.idle.scored));
		if (idleN) {
			const z = eps.filter((e) => e.idle.zero);
			const ok = eps.filter((e) => !e.idle.zero);
			const sz = sum(eps.map((e) => e.idle.sampledZero));
			const okN = sum(ok.map((e) => e.idle.scored - e.idle.sampledZero));
			rows.push(`beats with no action the program sent, P(the host's reading | the beat's last input): ${idleN} scored` +
				(okN ? `; mean log per beat ${f(sum(ok.map((e) => e.idle.loglik)) / okN)} (episodes without a p = 0 beat${sz ? ", sampled zeros left out" : ""})` : "") +
				`; p = 0 in ${sum(eps.map((e) => e.idle.zero))} beat(s) of ${z.length}/${eps.length} episode(s)` +
				(sz ? `; sampled zeros (below the tier's resolution, not impossible) ${sz} in ${eps.filter((e) => e.idle.sampledZero).length}/${eps.length} episode(s)` : ""));
		}
		// the watch's pricing (a lockstep or followed world): its tier, and the reading per beat whatever was scored above
		// (in a lockstep world with actions, an action's outcome is read on what it decides; the rest of the pass is here)
		const ex = sum(eps.map((e) => e.read.exact)), sa = sum(eps.map((e) => e.read.sampled));
		if (ex + sa) {
			const nz = sum(eps.map((e) => e.read.nonzero)), ns = eps.find((e) => e.read.n)?.read.n;
			rows.push(`the reading per beat, as the watch prices it: ${ex + sa} beats, tier exact ${ex}, sampled ${sa}` +
				(sa ? ` (${ns} seeded runs each, 95% half-width up to ${f(Math.max(...eps.map((e) => e.read.ci)))})` : "") +
				(nz ? `; mean log per beat ${f(sum(eps.map((e) => e.read.loglik)) / nz)} over its ${nz} nonzero beats` : "") +
				`; zero: exact ${sum(eps.map((e) => e.read.exactZero))} (impossible), sampled ${sum(eps.map((e) => e.read.sampledZero))}` +
				(ns ? ` (no run of ${ns} reached the reading: p < ${upper(ns).toPrecision(2)} at 95%, not impossible)` : ""));
		}
		rows.push(`surprises (readings the program gives zero probability) ${sum(eps.map((e) => e.surprises))} in ${eps.filter((e) => e.surprises).length} episode(s); ` +
			`rare (likelihood < ${RARE}) ${sum(eps.map((e) => e.rare))} in ${eps.filter((e) => e.rare).length} episode(s)`);
		if (mism.size)
			rows.push("mismatched atoms (the program's sampled state against the host's reading; + the world has it, − the program does): " +
				[...mism.entries()].sort((x, y) => y[1].beats - x[1].beats)
					.map(([a, m]) => `${a} ${m.beats}× in ${m.episodes.size} episode(s) (+${m.more} −${m.less})`).join("; "));
		const least = low.sort((x, y) => x.p - y.p).slice(0, 10);
		if (least.length)
			rows.push("the least likely answers of the world: " + least.map((w) => `seed ${w.seed} beat ${w.beat}: ${w.what}, which the program gives p = ${w.p.toPrecision(3)}`).join("; "));
		// each episode's end: the reported atoms it holds, beside its reward (a reward alone is misread)
		const ends = (e: Episode) => {
			const held = Object.entries(e.counts).filter(([, v]) => v > 0).map(([a, v]) => (v === 1 ? a : `${a} ${v}`));
			return held.length ? `ends with ${held.join(" ")}` : "ends with none of the reported atoms";
		};
		rows.push("per episode: " + eps.map((e) => `seed ${e.seed}: ${ends(e)}, ${e.beats} beats, ${e.scored} scored, log ${e.loglik === null ? "−∞" : f(e.loglik)}${e.reward !== undefined ? `, reward ${e.reward}` : ""}` +
			(e.idle.scored ? `, ${e.idle.scored} beats with no action (${e.idle.zero ? `${e.idle.zero} with p = 0` : `log ${f(e.idle.loglik)}`})` : "")).join("; "));
		rows.push(`The domain is now at the end of episode seed ${seed0 + n - 1}; domain_open starts it afresh.`);
		return rows.join("\n");
	}

	pi.registerTool({
		executionMode: "sequential",
		name: "domain_episodes",
		label: "measure episodes",
		description:
			"Measure the open domain against its world: n seeded episodes (each a reset with its seed, so the program's sampler and an RDDL world's gym " +
			"are the same per seed; world lines after each reset), each run to its end with every beat scored. It answers the outcome frequencies, " +
			"the program's likelihood of what the world did (per episode and the least likely beats: a rate that is off shows here, not only the impossible), " +
			"the surprises, and the mismatched atoms grouped. A measure: record it; it changes nothing.",
		parameters: Type.Object({
			n: Type.Optional(Type.Integer({ description: "how many episodes (1-50, default 10)", minimum: 1, maximum: 50 })),
			seed: Type.Optional(Type.Integer({ description: "the first episode's seed (default 1); the others follow it", minimum: 0 })),
			world: Type.Optional(Type.Array(Type.String(), { description: "world lines after each reset (domain_world's), for a scenario" })),
			max_beats: Type.Optional(Type.Integer({ description: "the beat cap per episode (default 200)", minimum: 1, maximum: 1000 })),
		}),
		async execute(_id, params) {
			const n = Math.min(50, Math.max(1, params.n ?? 10));
			const seed0 = params.seed ?? 1;
			const r = await episodes(n, seed0, params.world, params.max_beats ?? 200);
			const mismatch = Object.fromEntries([...r.mism.entries()].map(([a, m]) => [a, { beats: m.beats, episodes: m.episodes.size, more: m.more, less: m.less }]));
			return { content: [{ type: "text", text: cap(episodesText(n, seed0, r)) }], details: { measure: r.measure, episodes: r.eps, low: r.low, mismatch } };
		},
	});

	pi.on("session_shutdown", () => {
		agent?.close();
		agent = null;
	});
}
