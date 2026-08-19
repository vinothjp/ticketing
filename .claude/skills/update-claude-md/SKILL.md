---
name: update-claude-md
description: Review the work completed across today's Claude Code sessions and fold only the durable parts into CLAUDE.md — architecture changes, conventions, commands, dependencies, constraints, and decisions. Use when the user types /update-claude-md or asks to refresh, update, or top up CLAUDE.md after a day's work.
---

# Update CLAUDE.md

Fold today's work into `CLAUDE.md` so the next session starts knowing what this one
learned. `CLAUDE.md` is **standing guidance, not a changelog** — every line you add must
still be true and useful a month from now.

## 1. Gather evidence

Don't write from conversation memory alone — the point of this skill is to cover *all*
of today's sessions, including ones you weren't part of.

```bash
python .claude/skills/update-claude-md/scripts/scan_sessions.py   # every prompt, all sessions
git log --since=midnight --stat                                   # what landed
git status --short                                                # what's still uncommitted
git diff                                                          # the actual changes
```

Pass an explicit `YYYY-MM-DD` to `scan_sessions.py` to review a different day. It filters
on each entry's own `timestamp`, not file mtimes (resuming an old session restamps its
file). This skill is self-contained — don't pull material from `/daily-log` or its output;
a journal entry is a summary of activity, and what belongs in `CLAUDE.md` is a different
question answered from the sessions and the diff directly.

Prompts show *intent*; the diff shows *outcome*. When they disagree, believe the diff.
Read the real diff for any file whose change you can't describe confidently — a wrong
line in `CLAUDE.md` misleads every future session.

Then read the current `CLAUDE.md` in full before editing. Much of what today's work
taught is probably already documented, sometimes in different words.

## 2. Decide what is durable

Add or amend only these:

- **Architecture** — a new module/domain, a changed data model, a moved boundary, how two
  parts now talk to each other.
- **Conventions** — an ordering rule, a naming rule, a "we always do X here" that a future
  session would otherwise break.
- **Commands** — a build/test/migrate/verify incantation that isn't discoverable from
  `package.json`, or one with a non-obvious flag.
- **Dependencies & environment** — a new package, service, container, or env var, plus any
  install gotcha.
- **Constraints & traps** — a footgun that cost time today: a tool that silently passes, a
  library behaviour that quietly eats state, a mapping you must not "fix". These are the
  highest-value entries in the file. Write the symptom *and* the cause.
- **Decisions** — a deliberate choice with a rationale, especially one that looks wrong
  without context ("there is deliberately no X — it was removed because…").

Leave out:

- Anything git or the code already tells you: file lists, what a function does, past bug
  fixes, refactor history, dates, session narrative.
- Work that was proposed, reverted, or rejected. If the user pushed back and it was
  undone, it didn't happen.
- One-off task state ("currently debugging the invoice page"), TODOs, and aspirations.
- Restatements of a rule already in the file — amend the existing line instead.

Rule of thumb: if it reads as *what happened today*, it doesn't belong here. Only
*what is true about this codebase* does.

## 3. Edit

- **Smallest diff that carries the information.** Extend the section that already owns the
  topic; only add a new `##` section for a genuinely new domain or subsystem.
- Match the file's voice: terse, imperative, second person, backticked paths, bold for the
  trap itself. Read a neighbouring section and write like it.
- Keep the existing section order and headings stable — sessions navigate this file by
  heading.
- Prune while you're in there: if today's work made a line false, fix or delete it. A
  stale instruction is worse than a missing one.
- Contradictions get resolved, not stacked. Never leave two rules that disagree.
- Don't bloat. If a section grows past ~10 lines of prose, tighten it rather than append.

## 4. Report

Tell the user, in a few lines, what you added, what you amended, and what you deliberately
left out and why. If today produced nothing durable, say exactly that and change nothing —
that's a valid outcome, not a failure.
