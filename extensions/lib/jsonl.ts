// A child process speaking JSON lines on stdio (docs/LOOP-AGENT.md "The
// extensions"): one process per pi session, held by an extension, closed at
// session_shutdown. No logic of its own: a line in, the lines out until the
// caller's `done(line)` says the answer is complete; lines that arrive with no
// request waiting go to `onUnasked`.
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

export type Line = Record<string, unknown>;

export class JsonlChild {
	private proc: ChildProcessWithoutNullStreams;
	private buf = "";
	private waiting: { collect: Line[]; done: (l: Line) => boolean; resolve: (ls: Line[]) => void; reject: (e: Error) => void }[] = [];
	private stderr = "";
	exited: number | null = null;
	private onUnasked: (l: Line) => void;

	constructor(cmd: string, args: string[], opts: { cwd?: string; env?: NodeJS.ProcessEnv }, onUnasked: (l: Line) => void = () => {}) {
		this.onUnasked = onUnasked;
		this.proc = spawn(cmd, args, { cwd: opts.cwd, env: opts.env, stdio: ["pipe", "pipe", "pipe"] });
		this.proc.stdout.setEncoding("utf8");
		this.proc.stdout.on("data", (chunk: string) => this.feed(chunk));
		this.proc.stderr.setEncoding("utf8");
		this.proc.stderr.on("data", (c: string) => {
			this.stderr = (this.stderr + c).slice(-4000);
		});
		this.proc.on("exit", (code) => {
			this.exited = code ?? -1;
			const err = new Error(`${cmd} exited (${this.exited}): ${this.stderr.trim().slice(-600)}`);
			for (const w of this.waiting.splice(0)) w.reject(err);
		});
	}

	private feed(chunk: string) {
		this.buf += chunk;
		let i: number;
		// split on LF only (JSON strings may hold U+2028/U+2029)
		while ((i = this.buf.indexOf("\n")) >= 0) {
			const raw = this.buf.slice(0, i).replace(/\r$/, "");
			this.buf = this.buf.slice(i + 1);
			if (!raw.trim()) continue;
			let line: Line;
			try {
				line = JSON.parse(raw);
			} catch {
				line = { unparsed: raw };
			}
			const w = this.waiting[0];
			if (!w) {
				this.onUnasked(line);
				continue;
			}
			w.collect.push(line);
			if (w.done(line)) {
				this.waiting.shift();
				w.resolve(w.collect);
			}
		}
	}

	/** Write one line; resolve with every line out until done(line) is true. */
	request(line: Line | null, done: (l: Line) => boolean, timeoutMs = 600_000): Promise<Line[]> {
		if (this.exited !== null) return Promise.reject(new Error(`the process has exited (${this.exited}): ${this.stderr.trim().slice(-600)}`));
		return new Promise((resolve, reject) => {
			const t = setTimeout(() => reject(new Error(`no answer in ${timeoutMs / 1000} s`)), timeoutMs);
			this.waiting.push({
				collect: [],
				done,
				resolve: (ls) => {
					clearTimeout(t);
					resolve(ls);
				},
				reject: (e) => {
					clearTimeout(t);
					reject(e);
				},
			});
			if (line) this.proc.stdin.write(`${JSON.stringify(line)}\n`);
		});
	}

	close() {
		if (this.exited === null) {
			this.proc.stdin.end();
			setTimeout(() => this.exited === null && this.proc.kill(), 3000).unref();
		}
	}
}

/** A model-facing result text, capped (the full value stays in details). */
export function cap(text: string, n = 4000): string {
	return text.length <= n ? text : `${text.slice(0, n)}\n… (${text.length - n} more characters)`;
}
