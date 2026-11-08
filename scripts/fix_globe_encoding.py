"""Targeted mojibake repairs for the sequences PowerShell produced."""
import io

PATH = "frontend/src/globe/GlobeScene.ts"
PAIRS = [
    ("\u00e2\u2030\u02c6", "\u2248"),      # approx
    ("\u00c2\u00b0", "\u00b0"),            # degree
    ("\u00c2\u00b1", "\u00b1"),            # plus-minus
    ("\u00e2\u2020\u2019", "\u2192"),      # arrow
    ("\u00e2\u20ac\u201d", "\u2014"),      # em dash
    ("\u00e2\u20ac\u2122", "\u2019"),
    ("\u00e2\u20ac\u0153", "\u201c"),
]

text = io.open(PATH, encoding="utf-8").read()
before = text
for bad, good in PAIRS:
    text = text.replace(bad, good)

io.open(PATH, "w", encoding="utf-8", newline="").write(text)
print("changed" if text != before else "no change")
