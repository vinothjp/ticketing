---
name: daily-log
description: Scan all of today's Claude Code sessions plus git activity and write a short entry into the user's company daily journal file. Use when the user types /daily-log or asks for a work log, daily summary, standup note, or journal entry of what was done today.
---

# Daily log

Produce a copy-pasteable journal entry of today's work on this repo, for the user's
company daily journal.

## Gather evidence

Run these first. Don't write the entry from conversation memory alone — the point of
this skill is to cover *all* of today's sessions, including ones you weren't part of.

1. **Today's prompts across every session:**
   ```bash
   python .claude/skills/daily-log/scripts/scan_today.py
   ```
   Pass an explicit `YYYY-MM-DD` to log a different day. This reads
   `~/.claude/projects/<slug>/*.jsonl` and filters on each entry's own `timestamp`
   field — file mtimes lie, because resuming an old session today restamps its file.

2. **What actually landed in the code:**
   ```bash
   git log --since=midnight --oneline
   git status --short
   git diff --stat
   ```
   Prompts show *intent*; the diff shows *outcome*. Prefer the diff when they disagree —
   a request the user later rejected must not appear as delivered work.

3. If a change is unclear, read the actual diff for that file before describing it.

## Write the entry into the journal

Don't print the entry for the user to copy — **write it into the journal file**, which
lives at `C:\aadil\daily journal.txt` (override with the `DAILY_JOURNAL` env var):

```bash
python .claude/skills/daily-log/scripts/write_entry.py <<'EOF'
First point.
Second point.
EOF
```

One point per line on stdin. The script formats them in the journal's house style
(`19/8/26: wed-` with continuation lines indented to column 16), preserves the file's
CRLF/UTF-8 encoding, and **replaces** an existing entry for that date instead of
duplicating it — so re-running `/daily-log` later in the day is safe. Pass a
`YYYY-MM-DD` argument to write a different day. It aborts rather than write if the
result would drop any existing day.

Afterwards, show the user the entry you wrote (the script echoes it) so they can see
what landed, and say it's already saved.

Rules for the points:
- **4–5 bullets maximum, each 1–2 lines.** This is a hard limit. Merge related work into
  one bullet rather than adding a sixth.
- Lead each bullet with the outcome, then the essential why. "Fixed X — it was doing Y."
- Write for a manager who doesn't know this codebase: name features and behaviour, not
  files, functions, or variable names.
- Group by feature or workstream, not by session or chronology.
- Bug fixes: say what was broken in user terms, not just what was patched.
- No filler ("various improvements", "worked on"), no effort claims, no adjectives like
  "successfully" or "comprehensive".

The journal's house style is prose lines, not markdown: no `-` bullets, no bold, no
wrapping (one point per line, however long). Match the surrounding entries.

After reporting what was written, add at most two short lines of caveats — only genuine
ones, such as work still uncommitted or migrations applied only to the local DB. Skip
this if there's nothing real to flag.

## Accuracy

- Never list work that was reverted, rejected, or only proposed. If the user pushed back
  on something and it was undone, it didn't happen.
- Don't claim verification that didn't occur.
- If a day has no activity, say so plainly instead of padding.
