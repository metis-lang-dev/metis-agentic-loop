"""The lamp's world (agentic-loop s-3ddb3e87's worked example, docs/LOOP-AGENT.md):
a desk lamp the person switches on and off. It is the world the loop formalizes,
not part of the formalization: like a robot's driver it exists first, and its
names are fixed — the person's prose names them (lit, dark, cmd_on, cmd_off,
worn), and the program the loop writes must use them.

- tick: the outcome tokens of the last beat (done(...)) narrated and cleared;
  while the lamp is lit, the bulb wears: after BURN_AFTER - 1 lit beats the
  host reports `+worn` (a world fact), and at BURN_AFTER the bulb burns out.
- observe: what the lamp shows. It follows the program's own lit/dark (the
  host knows no rule names) except after a burn-out: the lamp is dark while a
  program without burn-outs still says lit — the unmodeled reading, the
  surprise. An extension that consumes the report (`lit * worn -o dark`)
  explains the next one. Switching it off (the program dark) ends a burn-out:
  the bulb is changed.
PURITY: the env mutates only in tick; snapshot is total."""
import sys

OUTCOMES = ("done",)
PAIRS = ()
WORDS = {}
KEYS = {}
STANDING = ()

BURN_AFTER = 6       # lit beats until the bulb burns out


def key(atom, names=None):
    return None


def words(atom, names=None):
    return None


def flips(atom):
    return None


class LampHost:
    def __init__(self, case):
        self.beat = 0
        self.due = ()
        self.acted = ()
        self.script, self.last = {}, None
        self.lit_beats = 0
        self.burnt = False

    def bind(self, reg):
        pass

    def tick(self, counts):
        if self.last is not None and self.beat >= self.last:
            return None
        self.beat += 1
        dos = []
        for a, n in sorted(counts.items()):
            if a.split("(")[0].startswith(OUTCOMES):      # done(on), or done_on as a draft may name it
                print(f"  [lamp beat {self.beat}] narrated {a}", file=sys.stderr)
                dos.append(f"-{a} {n}")
        if counts.get("dark", 0) > 0:
            self.lit_beats, self.burnt = 0, False      # off (or explained): a new bulb
        elif counts.get("lit", 0) > 0 and not self.burnt:
            self.lit_beats += 1
            if self.lit_beats == BURN_AFTER - 1:
                dos.append("+worn")
                print(f"  [lamp beat {self.beat}] the bulb is worn", file=sys.stderr)
            elif self.lit_beats >= BURN_AFTER:
                self.burnt = True
                print(f"  [lamp beat {self.beat}] the bulb burnt out", file=sys.stderr)
        return dos

    def on_event(self, name, args):
        self.acted += ((self.beat, name, tuple(args)),)

    def observe(self, counts):
        lit = 0 if self.burnt else (1 if counts.get("lit", 0) > 0 else 0)
        return {"lit": lit, "dark": 1 - lit}

    def snapshot(self):
        return (self.beat, self.due, self.acted, self.lit_beats, self.burnt)

    def restore(self, snap):
        beat, due, acted, self.lit_beats, self.burnt = snap
        self.beat = beat
        self.due = tuple((b, d) for b, d in due)
        self.acted = tuple((b, n, tuple(a)) for b, n, a in acted)


def make(case):
    return LampHost(case)
