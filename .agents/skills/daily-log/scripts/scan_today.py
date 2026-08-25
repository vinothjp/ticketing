"""Collect this project's Claude Code activity for a given day.

Usage:  python scan_today.py [YYYY-MM-DD]   (defaults to today)

Prints every user prompt from that day, grouped by session, oldest first.
Sessions are the raw material for the journal entry — read them alongside
`git log` / `git diff` to see what was actually built.

Note: transcript file mtimes are NOT a reliable date filter — an old session
resumed today gets today's mtime while containing month-old messages. This
filters on each entry's own `timestamp` field instead.
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
    # Fall back to the closest match, then to whichever dir was touched last.
    tail = os.path.basename(cwd).lower()
    cands = [d for d in glob.glob(os.path.join(root, "*")) if os.path.isdir(d)]
    named = [d for d in cands if os.path.basename(d).lower().endswith(tail)]
    pool = named or cands
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
            # Skip system reminders, hook output, and injected skill/command
            # preambles — none of these are things the user actually asked for.
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
        print(f"  [{clock}] {body[:400]}")
    print()
