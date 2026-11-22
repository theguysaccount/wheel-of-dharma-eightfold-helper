"""Fetch the quoted passages from SuttaCentral's translation data and check their license.

    python3 pipeline/sources.py            # write site/data/quotes.json
    python3 pipeline/sources.py --verify   # exit 1 if any quote, citation or license differs from the source
    python3 pipeline/sources.py --update   # rewrite quotes.json if the source text was revised; prints "changed"

Source: github.com/suttacentral/bilara-data (branch "published"), Bhikkhu Sujato's English
translations, which SuttaCentral publishes under Creative Commons Zero (CC0). Every collection used
must say so in _publication-v2.json, or nothing is written. Standard library only.
"""
import argparse
import json
import re
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SOURCES = ROOT / "site" / "data" / "sources.json"
QUOTES = ROOT / "site" / "data" / "quotes.json"
RAW = "https://raw.githubusercontent.com/suttacentral/bilara-data/published"
UA = "EightfoldHelper/1.0 (+https://github.com/theguysaccount/wheel-of-dharma-eightfold-helper)"


def fetch_json(url, tries=4):
    for attempt in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=40) as r:
                return json.loads(r.read().decode("utf-8"))
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as e:
            if attempt == tries - 1:
                raise RuntimeError(f"{url}: {e}") from e
            time.sleep(3 * (attempt + 1))
    return None


def clean(s):
    return re.sub(r"\s+", " ", s.replace("<j>", " ")).strip()


def licenses(translator, collections):
    """{collection: license abbreviation} for the translator's publications."""
    pubs = fetch_json(f"{RAW}/_publication-v2.json")
    items = pubs.values() if isinstance(pubs, dict) else pubs
    found = {}
    for p in items:
        if p.get("creator_uid") != translator:
            continue
        uid = p.get("text_uid", "")
        for c in collections:
            if uid == c:
                found[c] = (p.get("license_abbreviation") or "", p.get("license_url") or "", p.get("translation_title") or "")
    return found


def build():
    src = json.loads(SOURCES.read_text(encoding="utf-8"))
    translator = src["translator"]
    texts = src["texts"]
    collections = sorted({t["collection"] for t in texts.values()})
    lic = licenses(translator, collections)
    problems = []
    for c in collections:
        if c not in lic:
            problems.append(f"no publication record for {translator}/{c}")
        elif lic[c][0] != "CC0":
            problems.append(f"{translator}/{c} is licensed {lic[c][0]!r}, not CC0")
    data = {}
    for uid, t in texts.items():
        data[uid] = fetch_json(f"{RAW}/translation/en/{translator}/sutta/{t['path']}_translation-en-{translator}.json")
    quotes = {}
    for qid, q in src["quotes"].items():
        t = texts[q["text"]]
        seg_ids = [s if ":" in s else f"{q['text']}:{s}" for s in q["segs"]]
        lines = []
        for sid in seg_ids:
            if sid not in data[q["text"]]:
                problems.append(f"{qid}: segment {sid} no longer exists in {q['text']}")
                continue
            lines.append(clean(data[q["text"]][sid]))
        title_key = next((k for k in (f"{q['text']}:0.3", f"{q['text']}:0.2") if k in data[q["text"]]), None)
        title = clean(data[q["text"]][title_key]) if title_key else ""
        if q["text"] == "dhp1-20":
            num = seg_ids[0].split(":")[0][3:]
            cite = f"Dhp {num}"
            title = "Sayings of the Dhamma"
        else:
            first, last = seg_ids[0].split(":")[1], seg_ids[-1].split(":")[1]
            cite = f"{t['cite']}:{first}" + (f"–{last}" if last != first else "")
        page = t.get("page", q["text"])
        quotes[qid] = {"cite": cite, "title": title, "lines": lines, "segments": seg_ids,
                       "url": f"https://suttacentral.net/{page}/en/{translator}",
                       "license": "CC0", "translator": "Bhikkhu Sujato"}
    return {"source": "SuttaCentral, translations by Bhikkhu Sujato (CC0)", "quotes": quotes}, problems


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--verify", action="store_true")
    ap.add_argument("--update", action="store_true")
    args = ap.parse_args()
    fresh, problems = build()
    for p in problems:
        print(f"::error::{p}")
    if problems:
        return 1
    current = json.loads(QUOTES.read_text(encoding="utf-8")) if QUOTES.exists() else None
    if args.verify:
        if current != fresh:
            for qid in sorted(set(fresh["quotes"]) | set((current or {}).get("quotes", {}))):
                a = (current or {}).get("quotes", {}).get(qid)
                b = fresh["quotes"].get(qid)
                if a != b:
                    print(f"::error::{qid} differs from the source: {json.dumps(a)[:200]} -> {json.dumps(b)[:200]}")
            return 1
        print(f"all {len(fresh['quotes'])} quotes match the source word for word; every collection is CC0")
        return 0
    if current == fresh:
        print(f"quotes.json is up to date ({len(fresh['quotes'])} quotes)")
        return 0
    QUOTES.write_text(json.dumps(fresh, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"{'changed: ' if args.update and current else ''}wrote {QUOTES.relative_to(ROOT)} ({len(fresh['quotes'])} quotes)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
