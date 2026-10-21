# Learning worlds: the agentic loop as a domain's learning substrate (r0.2 program, the architect, 2026-10-21)

The user (2026-10-21): the agentic loop standalone is not interesting in interactive use —
the human loop and the agent UI cover that — but its role in a domain that LEARNS is
unexplored. A series of close-to-real tasks exercises the neuro-symbolic capability: a
small world, formalized by the agentic loop, an agent running in the simulated environment,
discovering the world's uncertainty, designing new rules; the agentic loop improving the
domains encountered; proper domain separation and activation by the agent from context.

## The claim under test

Learning happens by changing symbolic structure, not by retraining the model. In a world
the rules do not fully describe, the agent's surprises (the domain agent's records: an
observed transition the program could not produce, or priced low) are the signal; the
agentic loop turns a record into a proposed rule or extension; a gate decides; the domain
reloads; the agent runs again — on configurations it has not seen. Two numbers say whether
it worked (both from the user's research note):

- **surprise resolution** — the fraction of initially unexplained outcomes that become
  predictable after an accepted extension;
- **generalization gain** — the improvement in likelihood and task success on held-out
  world configurations, never on the trajectories the rule was invented from.

A third keeps us honest: **cost per accepted rule** (model calls, USD, wall time).

## The closed loop

```
world (host) ──beats──▶ domain agent ──surprise records──▶ agentic loop ──proposal──▶ gate ──accept──▶ reload
    ▲                                                                                   │
    └──────────────── the agent runs again, on the held-out configurations ◀───────────┘
```

Every piece exists today as a separate tool: hosts that step a simulator (the RDDL hosts,
the dog, the plant, the lamp), the domain agent scoring every beat and recording surprises
(metis-agent), the agentic loop formalizing and extending through the gate (this repo over
the loop SDK's `gate`), the catalog's packages and reload. What has never been built is the
closure: the record flowing into the loop without a person carrying it, a gate policy that
runs unattended, and the measurement around it.

**The gate policy for experiments.** The catalog's gate stays human (SPEC §10). A learning
series needs hundreds of proposals, so it runs an EXPERIMENTAL gate policy, logged for the
human to review after the run: a proposed rule is accepted iff its generalization gain is
positive on the held-out configurations (likelihood up, or task success up with likelihood
not down), refused otherwise — with the refused proposals kept as records. This is the
note's distinction made operational: a surprise that no accepted rule ever resolves is
irreducible stochasticity (the world's), one that an accepted rule resolves was a missing
rule (ours).

## Two approaches, two worlds, one comparison (for the agent paper)

| | ALFWorld (first) | MiniHack (second) |
|---|---|---|
| who acts | the kernel's program acts through the host (the RDDL pattern); no small model in the loop | the small LLM agent (Gemma E2B, metis-agent) acts, with the domain's intents; the domain is EXTRACTED after |
| the approach | design the domain first, add the voice/LLM interface later | put the agent in the loop first, extract the domain from what it did |
| grounding | ALFWorld exposes the underlying PDDL facts: atoms for free, the host is like `rddl_host.py` | NLE's glyphs/chars/messages: a perception adapter (the map as atoms: cells, the agent, objects, monsters; messages as events) |
| what the loop learns | preconditions and effects the agent's own rules miss (a dirty mug, a blocked sink: AsgardBench's cases) | the composition of hazards, items and terrain across held-out level variants |
| held-out | task variants and scenes ALFWorld ships (train / valid-seen / valid-unseen) | MiniHack's configurable levels: hold out combinations never seen in discovery |
| what the paper gets | the pros and cons of "domain then interface" | the pros and cons of "agent then domain" |

ScienceWorld follows ALFWorld only if its object state is reachable through its API (text
alone needs a perception card, a research problem of its own). Melting Pot comes after
rules about other agents are meaningful.

## Where the code lives

Each world is its own repository (the user): the plug between a simulator and the loop is
not generic enough to carry in metis-catalog. `metis-lang-dev/metis-world-alfworld` and
`metis-lang-dev/metis-world-minihack` hold the world's host, its perception/grounding, the
configuration families and the held-out splits, the experiment scripts and their records;
the metis side (the closure in this repo, the gate policy, the metrics in the loop SDK, the
domain agent's part) stays in the metis repos. The architect writes and tests the world
code; opus and nina the metis code.

## The complexity vector (measured per world, before combining)

state diversity (sampled coverage) · action branching (mean, p95 legal actions) · outcome
branching (distinct next states per state-action) · horizon (median, p95 steps to goal) ·
rule complexity (the program's rule count) · uncertainty (conditional outcome entropy from
the measure) · distribution diversity (independent configurations, held-out variants) ·
partial observability (hidden variables that decide the next outcome). The hosts and the
recorder give the first seven; the eighth is the world's documentation. A composite
(weighted geometric mean) ranks candidates; the vector stays beside it.

## The series

1. **world-alfworld** — the world repo (host over ALFWorld's text env with PDDL facts as
   atoms, the task families, the splits, a baseline program for one task type), then the
   closure on it (metis side), then the measured runs.
2. **world-minihack** — the world repo (the NLE perception adapter, level families), the
   E2B agent in the loop through metis-agent, the extraction of the domain from the agent's
   runs (the agentic loop's `take`), the measured runs; the comparison written up.
3. **house** — several of our packages in one world (plant, lamp, kitchen): domain
   separation and activation from the observed atoms.
4. ScienceWorld / Melting Pot as the results warrant.
