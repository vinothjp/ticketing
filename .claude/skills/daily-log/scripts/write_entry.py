"""Write a day's entry into the company daily journal, in the file's house style.

Usage:
    python write_entry.py [YYYY-MM-DD] < points.txt

Reads the entry's points from stdin, one point per line (blank lines ignored),
and writes them as:

    19/8/26: wed-   First point on the header line
                    Second point, indented to column 16

If an entry for that date already exists it is REPLACED in place, so re-running
never duplicates a day. Otherwise the entry is appended at the end of the file.

The journal is CRLF-encoded UTF-8 and holds months of history — this script
preserves both, and refuses to write if the result would lose existing days.
"""
import io
import os
import re
import sys
from datetime import date, datetime

JOURNAL = os.environ.get("DAILY_JOURNAL", r"C:\aadil\daily journal.txt")
INDENT = 16
DAY_NAMES = ["mon", "tue", "wed", "thurs", "fri", "sat", "sun"]
# Any line that opens a dated entry: "19/8/26:" or a stray markdown "## 2026-08-19".
DATE_LINE = re.compile(r"^(?:\d{1,2}/\d{1,2}/\d{2}\s*:|##\s*\d{4}-\d{2}-\d{2})")


def header_for(d: date) -> str:
    return f"{d.day}/{d.month}/{d:%y}: {DAY_NAMES[d.weekday()]}-"


def belongs_to(line: str, d: date) -> bool:
    """True if `line` opens an entry for date `d`, in either style."""
    if line.startswith(f"{d.day}/{d.month}/{d:%y}:"):
        return True
    return bool(re.match(rf"^##\s*{d:%Y-%m-%d}\b", line))


def main() -> None:
    day = (
        datetime.strptime(sys.argv[1], "%Y-%m-%d").date()
        if len(sys.argv) > 1
        else date.today()
    )
    # Decode stdin as UTF-8 explicitly — Windows would otherwise assume cp1252
    # and mangle the em dashes and arrows the journal uses throughout.
    raw = sys.stdin.buffer.read().decode("utf-8", errors="replace")
    points = [p.strip() for p in raw.splitlines() if p.strip()]
    # Tolerate markdown bullets so the caller can pass the same text it displays.
    points = [re.sub(r"^[-*]\s+", "", p) for p in points]
    if not points:
        sys.exit("No points given on stdin — nothing written.")

    head = header_for(day)
    block = [head + " " * max(1, INDENT - len(head)) + points[0]]
    block += [" " * INDENT + p for p in points[1:]]

    with io.open(JOURNAL, encoding="utf-8", newline="") as fh:
        original = fh.read()
    lines = original.split("\r\n")
    before = sum(1 for ln in lines if DATE_LINE.match(ln))

    # Drop any existing entry for this date (header line + its indented body).
    out, i, replaced = [], 0, False
    while i < len(lines):
        if belongs_to(lines[i], day):
            replaced = True
            i += 1
            while i < len(lines) and not DATE_LINE.match(lines[i]):
                i += 1
            continue
        out.append(lines[i])
        i += 1

    while out and not out[-1].strip():
        out.pop()
    out += [""] + block + ["", ""]

    after = sum(1 for ln in out if DATE_LINE.match(ln))
    expected = before if replaced else before + 1
    if after != expected:
        sys.exit(f"Refusing to write: entry count {before} -> {after}, expected {expected}")

    with io.open(JOURNAL, "w", encoding="utf-8", newline="") as fh:
        fh.write("\r\n".join(out))

    print(f"{'Replaced' if replaced else 'Appended'} {head} in {JOURNAL}")
    for ln in block:
        print("  " + ln)


if __name__ == "__main__":
    main()
