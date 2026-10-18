The REPL serves an existing program, the seed: `{{SEED}}`. Make it the catalog domain `{{NAME}}`, as the dog and the lamp are laid out. The program is the person's: do not change its rules. No formalize and no revise of it, unless the person asks for a change and approves its diff.

1. `repl_state` and `repl_show` with arg llp: read what the program has (its atoms, rules, `#init` and `#query` lines, its header).
2. `catalog_apply` with domain={{NAME}} what=served: the seed, as it is, becomes the domain's program, with a domain.yaml. The person approves the diff.
3. Intents: `catalog_apply` with what=intents. It drafts the person's verbs from the program's commands (`cmd_*` atoms). A world without commands gets an intent.yaml that knows none (only UNKNOWN): the domain agent opens no domain without one. Say which it is.
4. Exercise: `domain_open` with domain={{NAME}}, then advance time (`domain_clock`) and read it (`domain_state`, `domain_events`). Say what the program does when it runs.
5. When the person asks: `catalog_take` with domain={{NAME}}. It brings the domain into the person's catalog with a README of where it came from.

Say briefly what you did after each step.
