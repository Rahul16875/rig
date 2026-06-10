# Ralph Lingum Loop

A self-improving Ralph loop as a [pi](https://pi.dev) extension.

**Classic Ralph** (Geoff Huntley's technique): an outer harness re-prompts a *fresh* agent
each iteration; the only memory is what gets written to disk. **This extension adds the
self-improvement channel** from Karpathy's [autoresearch](https://github.com/karpathy/autoresearch):
every iteration must distill durable lessons into `.ralph/learnings.md`, which is injected
into the next iteration's prompt — each fresh agent starts smarter than the last.

```
┌─> compose prompt = PROMPT.md (constitution) + learnings.md + plan.md + protocol
│       ↓
│   fresh pi session runs ONE plan item, verifies, commits
│       ↓
│   agent checks off plan item, distills lessons → learnings.md
│       ↓
└── repeat — until .ralph/DONE, max iterations, /ralph-stop, or `touch .ralph/STOP`
```

## Install

```bash
# global (all projects)
mkdir -p ~/.pi/agent/extensions && cp ralph-lingum-loop.ts ~/.pi/agent/extensions/

# or project-local
mkdir -p .pi/extensions && cp ralph-lingum-loop.ts .pi/extensions/

# or one-off
pi -e ./ralph-lingum-loop.ts
```

Requires pi (`npm i -g @earendil-works/pi-coding-agent`). Extensions are loaded via jiti —
no compilation needed.

## Usage

You just describe the task — the **agent writes its own constitution and plan** (bootstrap,
iteration 0): it explores the repo, then authors `.ralph/PROMPT.md` (mission, verification
commands, hard rules) and `.ralph/plan.md` (small, independently verifiable items) before
the loop starts.

```
/ralph add dark mode to the settings screen     # bootstrap from task, then loop until DONE
/ralph 25 migrate all API calls to v2 client    # optional hard budget of 25 iterations
/ralph --same-session <task>                    # persistent-context variant (watch context growth)
/ralph                                          # resume looping on an existing .ralph/ setup
/ralph-init <task>                              # bootstrap ONLY — review .ralph/ before /ralph
/ralph-init                                     # blank templates if you'd rather write them yourself
/ralph-stop                                     # graceful stop after the current iteration
```

**Completion-driven, not budget-driven.** The loop has no default iteration cap: it runs until
every plan item is checked off AND full verification passes AND the agent — reviewing the
result as a skeptic against the mission — writes `.ralph/DONE`. If the agent finds gaps, it
must add plan items instead of declaring victory. Safety nets, in place of a hardcoded cap:

- **Stall detector**: 3 consecutive iterations with no plan progress (nothing checked off,
  plan unchanged, no DONE) aborts the run — catches a confused agent before it burns tokens forever
- **Optional hard budget**: `/ralph 25 <task>` if you want a ceiling anyway
- **Kill switches**: `/ralph-stop` or `touch .ralph/STOP`

## Files (all in `.ralph/`)

| File | Who writes it | Purpose |
|---|---|---|
| `PROMPT.md` | agent (bootstrap) | constitution: mission, verification command, hard rules |
| `plan.md` | agent (bootstrap + loop) | checklist of work; agent does ONE item per iteration |
| `learnings.md` | agent | distilled rules / dead ends — the self-improvement channel |
| `loop.jsonl` | extension | append-only iteration log |
| `DONE` | agent | created only when all plan items are checked + verified |
| `STOP` | you | `touch .ralph/STOP` from any terminal to halt the loop |

## Design notes

- **One item per iteration** keeps diffs reviewable and failures cheap (Ralph's core bet).
- **Fresh session by default**: no context rot; learnings.md carries the distilled memory.
  `--same-session` keeps one conversation if you want full recall on short runs.
- **Curated, not appended**: the protocol tells the agent to merge/rewrite learnings bullets,
  not grow a diary — the file is read every iteration, so it must stay tight.
- **Done means verified**: `DONE` may only be written after full verification passes and a
  skeptical self-review against the mission — "the agent is happy" is gated on the test
  suite, not vibes. Cost control comes from the stall detector (+ optional budget), per
  Cherny/Van Horn's loop definition: prompt → evaluate → done-check → re-prompt, bounded.

## Status

v0: written against pi v0.79.x extension docs (`registerCommand`, `ctx.newSession`,
`sendUserMessage`, `waitForIdle`). Not yet exercised end-to-end — run a 2-iteration smoke
test on a toy plan first; the `newSession`/`withSession` recursion is the part most likely
to need adjustment as pi's API evolves.
