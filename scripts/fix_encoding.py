"""Repairs mojibake introduced by a PowerShell UTF-8 round-trip.

The file was written as UTF-8 but read back as CP-1252, so every non-ASCII
character became garbage. Only the MANGLED runs need fixing (edits made after
the corruption are already valid UTF-8), so this repairs character-by-character
and leaves genuine non-ASCII text untouched.

usage: python scripts/fix_encoding.py <file>
"""
import io
import sys

path = sys.argv[1]
with io.open(path, "r", encoding="utf-8") as f:
    text = f.read().lstrip("\ufeff")

# Characters produced when multi-byte UTF-8 is decoded as CP-1252.
MARKERS = "\u00c2\u00c3\u00e2\u20ac\u201a\u0153\u017e\u0161\u2039\u0178\u2019\u2122\u201d\u201c\u2013\u2014"

out = []
run = []


def flush():
    if not run:
        return
    chunk = "".join(run)
    try:
        out.append(chunk.encode("cp1252").decode("utf-8"))
    except (UnicodeEncodeError, UnicodeDecodeError):
        out.append(chunk)  # leave it alone if it is not clean mojibake
    run.clear()


for ch in text:
    if ch in MARKERS:
        run.append(ch)
    else:
        flush()
        out.append(ch)
flush()

repaired = "".join(out)
if repaired == text:
    print("no change", path)
else:
    with io.open(path, "w", encoding="utf-8", newline="") as f:
        f.write(repaired)
    print("repaired", path)
