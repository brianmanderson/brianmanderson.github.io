"""Build assets/js/publications.js for the website from the CV .docx."""
import json
import re
import sys

import docx
from docx.oxml.ns import qn

cv_path, out_path = sys.argv[1], sys.argv[2]
doc = docx.Document(cv_path)

lines = []
for el in doc.element.body.iterchildren():
    if el.tag == qn("w:p"):
        t = "".join(x.text or "" for x in el.iter(qn("w:t"))).strip()
        if t:
            lines.append(t)
    elif el.tag == qn("w:tbl"):
        for tr in el.iter(qn("w:tr")):
            cells = []
            for tc in tr.iter(qn("w:tc")):
                cells.append(" ".join("".join(x.text or "" for x in p.iter(qn("w:t"))) for p in tc.iter(qn("w:p"))).strip())
            lines.append(" | ".join(cells))

SECTIONS = [
    ("Invited Talks", "talk"),
    ("Book Chapters", "chapter"),
    ("Papers", "paper"),
    ("Oral Presentations", "oral"),
    ("Poster Presentations", "poster"),
    ("Abstracts", "abstract"),
]
STOP = ("Professional Training", "Publications")

items, current = [], None
for line in lines:
    head = line.rstrip("_ ").strip()
    matched = next((kind for name, kind in SECTIONS if head.startswith(name)), None)
    if matched:
        current = matched
        continue
    if head in STOP:
        current = None
        continue
    if not current:
        continue
    text = re.sub(r"\s+", " ", line).strip()
    years = re.findall(r"\b(?:19|20)\d{2}\b", text)
    dates = re.findall(r"\b(\d{2})/((?:19|20)\d{2})\b", text)
    year = int(dates[-1][1]) if dates else (int(years[-1]) if years else 0)
    month = int(dates[-1][0]) if dates else 0
    items.append({
        "type": current,
        "year": year,
        "month": month,
        "first": text.startswith("Anderson B.M"),
        "text": text,
    })

items.sort(key=lambda i: (i["year"], i["month"]), reverse=True)

with open(out_path, "w", encoding="utf-8") as f:
    f.write("// Generated from the CV by build_pubs.py. Do not edit by hand.\n")
    f.write("window.PUBS = ")
    json.dump(items, f, ensure_ascii=False, indent=1)
    f.write(";\n")

from collections import Counter
print(Counter(i["type"] for i in items), "no-year:", [i["text"][:50] for i in items if not i["year"]])
