"""Dump this project's Claude Code sessions for a given day.

Usage:  python scan_sessions.py [YYYY-MM-DD]   (defaults to today)

Prints every user prompt from that day, grouped by session, oldest first, so the
day's work can be reviewed in full — including sessions the current one wasn't
part of. Read it alongside `git log` / `git diff`: prompts show intent, the diff
shows outcome.

Transcript file mtimes are NOT a usable date filter — resuming an old session
today gives its file today's mtime while its content is months old. This filters
on each entry's own `timestamp` field instead.
"""
import glob
import json
import os
import sys
from datetime import date

day = sys.argv[1] if len(sys.argv) > 1 else date.today().isoformat()


def project_dir() -> str:
    """Locate ~/.claude/projects/<slug> for the current working directory."""
    root = os.path.join(os.path.expanduser("~"), ".claude", "projects")
    cwd = os.getcwd()
    # Claude Code slugifies the path: "c:\aadil\ticketing" -> "c--aadil-ticketing"
    slug = cwd.replace(":", "-").replace("\\", "-").replace("/", "-").lower()
    exact = os.path.join(root, slug)
    if os.path.isdir(exact):
        return exact
    # Fall back to the closest name match, then to whichever dir was touched last.
    tail = os.path.basename(cwd).lower()
    dirs = [d for d in glob.glob(os.path.join(root, "*")) if os.path.isdir(d)]
    pool = [d for d in dirs if os.path.basename(d).lower().endswith(tail)] or dirs
    if not pool:
        sys.exit(f"No transcripts found under {root}")
    return max(pool, key=os.path.getmtime)


def text_of(msg) -> str:
    """Flatten a message's content to plain text, ignoring tool calls/results."""
    content = msg.get("content")
    if isinstance(content, str):
        return content
    if not isinstance(content, list):
        return ""
    return " ".join(
        b.get("text", "")
        for b in content
        if isinstance(b, dict) and b.get("type") == "text"
    )


pdir = project_dir()
sessions = []

for path in sorted(glob.glob(os.path.join(pdir, "*.jsonl"))):
    prompts, first_ts = [], None
    with open(path, encoding="utf-8", errors="replace") as fh:
        for line in fh:
            try:
                entry = json.loads(line)
            except json.JSONDecodeError:
                continue
            ts = str(entry.get("timestamp", ""))
            if entry.get("type") != "user" or not ts.startswith(day):
                continue
            body = " ".join(text_of(entry.get("message", {})).split())
            # Drop system reminders, hook output and injected skill preambles —
            # none of these are things the user actually asked for.
            noise = ("<", "Caveat:", "Base directory for this skill:")
            if not body or body.startswith(noise):
                continue
            prompts.append((ts[11:16], body))
            first_ts = first_ts or ts
    if prompts:
        sessions.append((first_ts, os.path.basename(path)[:8], prompts))

sessions.sort()

if not sessions:
    print(f"No sessions found for {day} in {pdir}")
    sys.exit(0)

print(f"# Claude Code prompts for {day}")
print(f"# {len(sessions)} session(s) in {pdir}\n")
for _, sid, prompts in sessions:
    print(f"--- session {sid} ({len(prompts)} prompts) ---")
    for clock, body in prompts:
        print(f"  [{clock}] {body[:600]}")
    print()
