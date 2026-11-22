"""Render the 1200x630 share cards in site/assets/og/ with headless Chrome: python3 scripts/og.py"""
import html
import os
import shutil
import subprocess
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "site" / "assets" / "og"
CHROME = os.environ.get("CHROME") or next(
    (c for c in [shutil.which("google-chrome"), shutil.which("chromium"),
                 "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"] if c and Path(c).exists()), None)
CARD = """<!doctype html><html><head><meta charset="utf-8"><style>
html,body{{margin:0;width:1200px;height:630px;overflow:hidden}}
body{{background:#faf6ee;color:#241c12;font-family:"Iowan Old Style","Palatino Linotype",Palatino,Georgia,serif;
 display:flex;flex-direction:column;justify-content:space-between;padding:64px 76px;box-sizing:border-box}}
.top{{font:700 34px/1 -apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;display:flex;align-items:center;gap:14px}}
.dot{{width:22px;height:22px;border-radius:50%;border:5px solid #c88a1d;display:inline-block}}
h1{{font-size:84px;line-height:1.04;margin:0;max-width:1000px;letter-spacing:-.01em}}
.typed{{font-size:34px;color:#6a5d4c;margin:24px 0 0}}
.typed s{{color:#a39a8a}} .typed b{{background:#ffe2a8;color:#5a3b00;font-weight:400;padding:0 6px}}
.caret{{display:none}}
p.sub{{font:30px/1.3 -apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:#8a4f12;margin:0}}
</style></head><body>
<div class="top"><span class="dot"></span>Eightfold Helper</div>
<div><h1>{title}</h1><div class="typed">{typed}<span class="caret"></span></div></div>
<p class="sub">{sub}</p>
</body></html>"""


def render(name, title, typed, sub, work):
    page = work / f"{name}.html"
    page.write_text(CARD.format(title=html.escape(title), typed=typed, sub=html.escape(sub)), encoding="utf-8")
    subprocess.run([CHROME, "--headless=new", "--disable-gpu", "--no-first-run", "--hide-scrollbars", f"--user-data-dir={work / 'p'}",
                    "--window-size=1200,630", "--virtual-time-budget=2000", f"--screenshot={OUT / (name + '.png')}", page.as_uri()],
                   check=True, capture_output=True)
    print(OUT / f"{name}.png")


if __name__ == "__main__":
    if not CHROME:
        raise SystemExit("Chrome not found; set CHROME")
    OUT.mkdir(parents=True, exist_ok=True)
    work = Path(tempfile.mkdtemp())
    try:
        render("home", "Which parts of the path need your attention?", "view · intention · speech · action · livelihood · effort · mindfulness · concentration",
               "A private self-check on the Noble Eightfold Path.", work)
        render("path", "The Noble Eightfold Path, factor by factor.", "definitions, practices and questions, from the early discourses",
               "Quoting public-domain translations by Bhikkhu Sujato.", work)
    finally:
        shutil.rmtree(work, ignore_errors=True)
