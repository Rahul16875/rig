/**
 * Ralph Lingum Loop — a self-improving Ralph loop as a pi extension.
 *
 * Classic Ralph: an outer harness re-prompts a FRESH agent each iteration; the only
 * memory is what gets written to disk. This extension adds the autoresearch-style
 * self-improvement channel: every iteration must distill durable lessons into
 * .ralph/learnings.md, which is injected into the next iteration's prompt — so each
 * fresh agent starts smarter than the last.
 *
 * Commands:
 *   /ralph <task description>           bootstrap: agent explores the repo and writes its own
 *                                       .ralph/PROMPT.md + plan.md, then the loop starts
 *   /ralph [N] [--same-session] [task]  run the loop (unbounded by default; N is an optional
 *                                       hard budget, fresh session per iteration)
 *   /ralph-init [task]                  bootstrap only (review .ralph/ before looping);
 *                                       with no task, scaffolds blank templates instead
 *   /ralph-stop                         request a graceful stop after the current iteration
 *
 * The loop is completion-driven, not budget-driven: it runs until the agent has checked off
 * every plan item, run full verification, and — satisfied with the result — written
 * .ralph/DONE. Safety nets: a stall detector (3 consecutive iterations with no plan progress
 * aborts the run), an optional hard budget N, /ralph-stop, and `touch .ralph/STOP`.
 *
 * Install: copy this file to ~/.pi/agent/extensions/ (global) or .pi/extensions/
 * (project), or run `pi -e ./ralph-lingum-loop.ts`.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const DIR = ".ralph";
const F = (cwd: string) => ({
	dir: path.join(cwd, DIR),
	prompt: path.join(cwd, DIR, "PROMPT.md"),
	plan: path.join(cwd, DIR, "plan.md"),
	learnings: path.join(cwd, DIR, "learnings.md"),
	log: path.join(cwd, DIR, "loop.jsonl"),
	done: path.join(cwd, DIR, "DONE"),
	stop: path.join(cwd, DIR, "STOP"),
});

const PROMPT_TEMPLATE = `# Ralph constitution

## Mission
<what this loop is building/fixing, in one paragraph>

## Verification
<how to prove an item works, e.g. "npm test must pass" — the agent runs this every iteration>

## Hard rules
- Work on exactly ONE plan item per iteration.
- Never modify files outside <scope>.
- Commit after each verified item.
`;

const PLAN_TEMPLATE = `# Plan

- [ ] <first task>
- [ ] <second task>
`;

const LEARNINGS_TEMPLATE = `# Learnings

<!-- Distilled wisdom only — injected into every iteration's prompt. Curate ruthlessly. -->

## Rules that work
- (none yet)

## Dead ends (do not retry)
- (none yet)
`;

function read(p: string): string {
	return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : "";
}

function bootstrapPrompt(task: string): string {
	return [
		`You are iteration 0 (BOOTSTRAP) of the Ralph Lingum Loop. A human gave you this task:`,
		`\n> ${task}\n`,
		`Do NOT implement anything yet. Your only job is to set up the loop's memory files:`,
		`1. Explore the repository enough to understand the context (structure, stack, existing conventions, how to build/test).
2. Write ${DIR}/PROMPT.md — the constitution every future iteration reads:
   - **Mission**: the task above restated precisely, with success criteria (one paragraph).
   - **Verification**: the EXACT commands that prove an item works (test/build/lint). If none exist yet, make "set up verification" the first plan item.
   - **Hard rules**: scope limits (which paths may be touched), conventions to follow, things that must never break.
3. Write ${DIR}/plan.md — a markdown checklist ("- [ ] ...") of small, independently verifiable items, ordered by dependency. Each item must be completable AND verifiable in a single agent iteration. Prefer many small items over few big ones.
4. Do not create ${DIR}/DONE or check off any plan items.`,
		`\nEnd your final message with one line: "BOOTSTRAP COMPLETE: <number of plan items> items".`,
	].join("\n");
}

// Count "- [ ]" / "- [x]" checkboxes in plan.md to detect progress between iterations.
function planCounts(cwd: string): { open: number; done: number } {
	const plan = read(F(cwd).plan);
	return {
		open: (plan.match(/^\s*[-*] \[ \]/gm) ?? []).length,
		done: (plan.match(/^\s*[-*] \[[xX]\]/gm) ?? []).length,
	};
}

function envelope(cwd: string, iteration: number, max: number): string {
	const f = F(cwd);
	const iterLabel = Number.isFinite(max) ? `${iteration}/${max}` : `${iteration}`;
	return [
		`You are iteration ${iterLabel} of the Ralph Lingum Loop. You are a FRESH agent: your only memory of previous iterations is the files below — trust them over your instincts.`,
		`\n## Constitution (${DIR}/PROMPT.md)\n${read(f.prompt)}`,
		`\n## Distilled learnings (${DIR}/learnings.md) — follow these, they were earned the hard way\n${read(f.learnings)}`,
		`\n## Plan (${DIR}/plan.md)\n${read(f.plan)}`,
		`\n## Loop protocol — mandatory, in order
1. Pick exactly ONE unchecked plan item (most important first). Do not touch other items.
2. Implement it, then verify per the constitution. If verification fails, fix or revert before exiting.
3. Check the item off in ${DIR}/plan.md and commit your work.
4. Distill: update ${DIR}/learnings.md with any durable rule, gotcha, or dead end from this iteration. Curate — merge and rewrite bullets, don't let the file grow stale or long.
5. If you discover the plan is missing something the mission needs, ADD new unchecked items to ${DIR}/plan.md.
6. Completion check — only when ALL plan items are checked: run the FULL verification from the constitution, then critically review the result against the mission as a skeptic. Satisfied on both? Write a one-line summary to ${DIR}/DONE. Any gap, doubt, or failing/missing test? Do NOT write DONE — add plan items covering the gap instead.
End your final message with one line: "ITERATION ${iteration} RESULT: <what was done>".`,
	].join("\n");
}

export default function (pi: ExtensionAPI) {
	let running = false;
	let stopRequested = false;

	const shouldStop = (cwd: string, ctx: any): string | null => {
		const f = F(cwd);
		if (fs.existsSync(f.done)) return `DONE: ${read(f.done).trim()}`;
		if (stopRequested) return "stopped via /ralph-stop";
		if (fs.existsSync(f.stop)) return "stopped via .ralph/STOP file";
		if (ctx?.signal?.aborted) return "aborted";
		return null;
	};

	const logIteration = (cwd: string, entry: Record<string, unknown>) => {
		fs.appendFileSync(F(cwd).log, JSON.stringify(entry) + "\n");
	};

	// Agent writes PROMPT.md + plan.md from the task description; extension owns learnings.md.
	const bootstrap = async (ctx: any, task: string): Promise<boolean> => {
		const f = F(ctx.cwd);
		fs.mkdirSync(f.dir, { recursive: true });
		if (!fs.existsSync(f.learnings)) fs.writeFileSync(f.learnings, LEARNINGS_TEMPLATE);
		ctx.ui?.setStatus?.("ralph", "ralph bootstrap");
		pi.sendUserMessage(bootstrapPrompt(task));
		await ctx.waitForIdle();
		const ok = fs.existsSync(f.prompt) && fs.existsSync(f.plan);
		logIteration(ctx.cwd, { iteration: 0, mode: "bootstrap", task, ok, endedAt: new Date().toISOString() });
		if (!ok) ctx.ui?.notify?.("Bootstrap failed — agent did not write .ralph/PROMPT.md + plan.md", "error");
		return ok;
	};

	pi.registerCommand("ralph-init", {
		description: "Bootstrap .ralph/ from a task description (/ralph-init <task>); no task = blank templates",
		handler: async (args: string, ctx: any) => {
			const task = (args ?? "").trim();
			const f = F(ctx.cwd);
			if (task) {
				if (await bootstrap(ctx, task)) {
					ctx.ui.notify(`Bootstrap complete — review ${DIR}/PROMPT.md + plan.md, then run /ralph`, "info");
				}
				ctx.ui?.setStatus?.("ralph", undefined);
				return;
			}
			fs.mkdirSync(f.dir, { recursive: true });
			for (const [p, tpl] of [
				[f.prompt, PROMPT_TEMPLATE],
				[f.plan, PLAN_TEMPLATE],
				[f.learnings, LEARNINGS_TEMPLATE],
			] as const) {
				if (!fs.existsSync(p)) fs.writeFileSync(p, tpl);
			}
			ctx.ui.notify(`Scaffolded ${DIR}/ — edit PROMPT.md and plan.md, then run /ralph`, "info");
		},
	});

	pi.registerCommand("ralph-stop", {
		description: "Stop the Ralph Lingum Loop after the current iteration",
		handler: async (_args: string, ctx: any) => {
			stopRequested = true;
			ctx.ui.notify(running ? "Ralph will stop after this iteration" : "Ralph is not running", "info");
		},
	});

	pi.registerCommand("ralph", {
		description: "Run the Ralph Lingum Loop: /ralph [maxIterations] [--same-session] [task description]",
		handler: async (args: string, ctx: any) => {
			if (running) {
				ctx.ui.notify("Ralph is already running — /ralph-stop to stop it", "warning");
				return;
			}
			const cwd = ctx.cwd;
			const f = F(cwd);

			// Parse: optional --same-session flag, optional leading hard budget N, rest = task text.
			// No N means unbounded — the loop runs until the agent writes DONE (or stalls out).
			const sameSession = /--same-session\b/.test(args ?? "");
			let rest = (args ?? "").replace(/--\S+/g, "").trim();
			let max = Infinity;
			const numMatch = rest.match(/^(\d+)\b\s*/);
			if (numMatch) {
				max = Math.max(1, parseInt(numMatch[1], 10));
				rest = rest.slice(numMatch[0].length);
			}
			const task = rest.trim();

			running = true;
			stopRequested = false;
			pi.setSessionName?.("ralph-lingum-loop");

			// Bootstrap when the human gave a task, or when .ralph/ has never been set up.
			if (task || !fs.existsSync(f.prompt) || !fs.existsSync(f.plan)) {
				if (!task) {
					running = false;
					ctx.ui.notify("No .ralph/ setup found — run /ralph <task description> (or /ralph-init)", "error");
					return;
				}
				if (!(await bootstrap(ctx, task))) {
					running = false;
					ctx.ui?.setStatus?.("ralph", undefined);
					return;
				}
			}
			if (fs.existsSync(f.done)) fs.unlinkSync(f.done);
			if (fs.existsSync(f.stop)) fs.unlinkSync(f.stop);

			// Stall detector: an iteration "progresses" if it checks off a plan item, changes the
			// plan, or finishes. 3 stalled iterations in a row aborts the run — the safety net
			// that replaces a hardcoded cap.
			const MAX_STALLS = 3;
			let stalls = 0;

			const runIteration = async (iterCtx: any, iteration: number): Promise<void> => {
				const reason = shouldStop(cwd, iterCtx);
				if (reason || iteration > max) {
					finish(iterCtx, reason ?? `hard budget (${max} iterations) reached`);
					return;
				}
				iterCtx.ui?.setStatus?.("ralph", `ralph ${Number.isFinite(max) ? `${iteration}/${max}` : iteration}`);
				const startedAt = new Date().toISOString();
				const before = planCounts(cwd);

				const afterTurn = async (nextCtx: any) => {
					const after = planCounts(cwd);
					const done = fs.existsSync(f.done);
					const progressed = done || after.done > before.done || after.open !== before.open;
					stalls = progressed ? 0 : stalls + 1;
					logIteration(cwd, {
						iteration,
						mode: sameSession ? "same-session" : "fresh",
						startedAt,
						endedAt: new Date().toISOString(),
						plan: { open: after.open, done: after.done },
						progressed,
						stalls,
						done,
					});
					if (!done && stalls >= MAX_STALLS) {
						finish(nextCtx, `stalled — ${MAX_STALLS} iterations with no plan progress (see ${DIR}/loop.jsonl)`);
						return;
					}
					await runIteration(nextCtx, iteration + 1);
				};

				if (sameSession) {
					pi.sendUserMessage(envelope(cwd, iteration, max));
					await iterCtx.waitForIdle();
					await afterTurn(iterCtx);
				} else {
					// Fresh context per iteration (classic Ralph): new session, prompt it,
					// wait for the turn to finish, then recurse with the fresh ctx.
					await iterCtx.newSession({
						withSession: async (fresh: any) => {
							await fresh.sendUserMessage(envelope(cwd, iteration, max));
							await fresh.waitForIdle();
							await afterTurn(fresh);
						},
					});
				}
			};

			const finish = (finishCtx: any, reason: string) => {
				running = false;
				finishCtx.ui?.setStatus?.("ralph", undefined);
				finishCtx.ui?.notify?.(`Ralph Lingum Loop finished — ${reason}`, "info");
			};

			try {
				await runIteration(ctx, 1);
			} catch (err: any) {
				running = false;
				ctx.ui?.notify?.(`Ralph crashed: ${err?.message ?? err}`, "error");
				throw err;
			}
		},
	});
}
