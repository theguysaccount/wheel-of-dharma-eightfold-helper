"""Build the Eightfold Helper static site into dist/. Standard library only (Python 3.9+).

    python3 pipeline/build.py [--out dist]

Pages are HTML fragments in site/pages/ that start with a JSON block in an HTML comment (path, title,
description, ...). This script wraps each in the shared layout and writes the sitemap, robots.txt,
the IndexNow key file, 404.html, build.json and urls.txt.

Optional environment (GitHub repository variables in CI; see OPERATIONS.md):
    SITE_URL          canonical origin + path, no trailing slash (default: the GitHub Pages URL)
    GOATCOUNTER_URL   e.g. https://eightfold.goatcounter.com/count -> cookieless page counts on
    SUPPORT_URL       link to a donation page (e.g. GitHub Sponsors) -> money slot shown
    SUPPORT_LABEL     its button text (default "Support this site")
    BUILD_DATE        YYYY-MM-DD, to reproduce a build
    GITHUB_SHA        recorded in build.json so health checks can tell which commit is live
"""
import argparse
import datetime as dt
import hashlib
import html
import json
import os
import re
import shutil
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_SITE_URL = "https://theguysaccount.github.io/wheel-of-dharma-eightfold-helper"
REPO_URL = "https://github.com/theguysaccount/wheel-of-dharma-eightfold-helper"
BRAND = "Eightfold Helper"
THEME = "#7a4b16"
INDEXNOW_KEY = (ROOT / "site" / "indexnow-key.txt").read_text().strip()
NAV = [("", "Self-check"), ("path/", "The path"), ("sources/", "Sources"), ("about/", "About")]
FOOT = [("", "Eightfold path self-check"), ("path/", "The eight factors"), ("sources/", "Sources and license"), ("about/", "About and privacy")]
e = html.escape


def attr(s):
    return html.escape(str(s), quote=True)


def read_page(path):
    """Split a page file into its JSON front matter and its HTML body."""
    text = path.read_text(encoding="utf-8")
    m = re.match(r"\s*<!--\s*(\{.*?\})\s*-->\s*", text, re.S)
    if not m:
        raise SystemExit(f"{path}: missing the JSON block at the top")
    meta = json.loads(m.group(1))
    meta["source"] = path.name
    return meta, text[m.end():]


class Site:
    def __init__(self, out, today):
        self.out, self.today = Path(out), today
        self.site_url = os.environ.get("SITE_URL", "").strip().rstrip("/") or DEFAULT_SITE_URL
        self.goatcounter = os.environ.get("GOATCOUNTER_URL", "").strip()
        self.support = os.environ.get("SUPPORT_URL", "").strip()
        self.support_label = os.environ.get("SUPPORT_LABEL", "").strip() or "Support this site"
        self.factors = json.loads((ROOT / "site" / "data" / "factors.json").read_text(encoding="utf-8"))
        self.quotes = json.loads((ROOT / "site" / "data" / "quotes.json").read_text(encoding="utf-8"))
        self.commit = os.environ.get("GITHUB_SHA", "").strip() or "local"
        h = hashlib.sha1()
        for p in sorted((ROOT / "site").rglob("*")):
            if p.is_file():
                h.update(p.relative_to(ROOT).as_posix().encode() + b"\0" + p.read_bytes())
        self.ver = h.hexdigest()[:10]
        self.pages = [read_page(p) for p in sorted((ROOT / "site" / "pages").glob("*.html"))]
        self.indexable = []

    # ----- helpers -----
    def url(self, path):
        return f"{self.site_url}/{path}"

    def write(self, path, text):
        f = self.out / path
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_text(text, encoding="utf-8")

    def csp(self):
        """Pages may load their own files and nothing else, and may not send data anywhere."""
        script, connect, img = "'self'", "'none'", "'self' data:"
        if self.goatcounter:
            origin = "{0.scheme}://{0.netloc}".format(urlparse(self.goatcounter))
            script += " https://gc.zgo.at"
            connect = origin
            img += " " + origin
        return (f"default-src 'none'; script-src {script}; style-src 'self' 'unsafe-inline'; img-src {img}; "
                f"connect-src {connect}; form-action 'none'; base-uri 'none'")

    def privacy_line(self):
        if self.goatcounter:
            return "Page visits are counted with GoatCounter (no cookies, no personal data). Your answers stay in your browser."
        return "No accounts, no cookies, no analytics. Your answers stay in your browser."

    def fill(self, text, root, extra=None):
        values = {"root": root, "site_url": self.site_url, "repo_url": REPO_URL, "brand": BRAND,
                  "privacy_line": self.privacy_line(), "csp": e(self.csp()),
                  "quote_count": str(len(self.quotes["quotes"])),
                  "statement_count": str(sum(len(f["statements"]) for f in self.factors["factors"]))}
        values.update(extra or {})
        out = re.sub(r"\{\{(\w+)\}\}", lambda m: str(values[m.group(1)]) if m.group(1) in values else m.group(0), text)
        left = re.findall(r"\{\{\w+\}\}", out)
        if left:
            raise SystemExit(f"unfilled placeholders: {sorted(set(left))}")
        return out

    def layout(self, meta, body):
        path = meta["path"]
        if path == "404.html":
            after = self.site_url.split("://", 1)[1]
            root = "/" + after.split("/", 1)[1] + "/" if "/" in after else "/"
        else:
            root = "../" * path.count("/") or "./"
        here = ' aria-current="page"'
        current = meta.get("nav")
        nav = "".join(f'<a href="{root}{p}"{here if p == current else ""}>{e(t)}</a>' for p, t in NAV)
        foot = "".join(f'<a href="{root}{p}">{e(t)}</a>' for p, t in FOOT)
        extra = {}
        faq = meta.get("faq")
        if faq:
            extra["faq_html"] = '<div class="faq">' + "".join(
                f"<details><summary>{e(q)}</summary><p>{e(a)}</p></details>" for q, a in faq) + "</div>"
        extra["money_slot"] = (
            f'<section class="card money"><p>This site is free and has no ads. <a class="btn small" href="{attr(self.support)}" rel="noopener">{e(self.support_label)}</a></p></section>'
            if self.support else "")
        body = self.fill(body, root, extra)
        ld = ""
        for block in meta.get("jsonld", []):
            if faq and block.get("@type") == "FAQPage":
                block = dict(block, mainEntity=[{"@type": "Question", "name": q, "acceptedAnswer": {"@type": "Answer", "text": a}}
                                                for q, a in faq])
            text = self.fill(json.dumps(block, ensure_ascii=False), root, {"date": self.today.isoformat()})
            ld += '<script type="application/ld+json">%s</script>\n' % text.replace("</", "<\\/")
        cfg = json.dumps({"root": root, "siteUrl": self.site_url})
        guidance = ""
        if "helper.js" in meta.get("scripts", []):
            for name, data in (("factors", self.factors), ("quotes", self.quotes)):
                guidance += '<script type="application/json" id="%s">%s</script>\n' % (name, json.dumps(data, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/"))
        scripts = f'<script type="application/json" id="site-config">{cfg}</script>\n' + guidance + "".join(
            f'<script type="module" src="{root}assets/{name}?v={self.ver}"></script>\n' for name in meta.get("scripts", []))
        gc = (f'<script data-goatcounter="{attr(self.goatcounter)}" async src="https://gc.zgo.at/count.js"></script>\n'
              if self.goatcounter else "")
        title, description = meta["title"], meta["description"]
        canonical = self.url("" if path == "404.html" else path)
        robots = '<meta name="robots" content="noindex">\n' if meta.get("noindex") else ""
        return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="{attr(self.csp())}">
<meta name="referrer" content="no-referrer">
<title>{e(title)}</title>
<meta name="description" content="{attr(description)}">
<link rel="canonical" href="{canonical}">
{robots}<meta property="og:type" content="website">
<meta property="og:site_name" content="{attr(BRAND)}">
<meta property="og:title" content="{attr(title)}">
<meta property="og:description" content="{attr(description)}">
<meta property="og:url" content="{canonical}">
<meta property="og:image" content="{self.site_url}/assets/og/{meta.get('og', 'home')}.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="theme-color" content="{THEME}">
<link rel="icon" href="{root}favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="{root}assets/site.css?v={self.ver}">
{ld}{scripts}{gc}</head>
<body class="{attr(meta.get('body_class', 'doc'))}">
<a class="skip" href="#main">Skip to content</a>
<header class="site-head"><div class="wrap">
<a class="logo" href="{root}"><span class="mark" aria-hidden="true"></span>{e(BRAND)}</a>
<nav class="nav" aria-label="Main">{nav}</nav>
</div></header>
<main id="main" class="wrap">
{body}
</main>
<footer class="site-foot"><div class="wrap">
<nav aria-label="Footer">{foot}<a href="{REPO_URL}">Source code</a></nav>
<p>A reflection aid, not a measure of spiritual progress or a substitute for a teacher. Not affiliated with any Buddhist organisation. Not medical or psychological advice.</p>
<p>{e(self.privacy_line())}</p>
</div></footer>
</body>
</html>
"""

    # ----- outputs -----
    def assets(self):
        shutil.copytree(ROOT / "site" / "assets", self.out / "assets")
        shutil.copy(ROOT / "site" / "favicon.svg", self.out / "favicon.svg")

        # Every import carries the build version, so a returning visitor never mixes old and new files.
        for f in (self.out / "assets").glob("*.js"):
            src = f.read_text(encoding="utf-8")
            src = re.sub(r'(from\s+"\./[\w.-]+\.js)"', rf'\1?v={self.ver}"', src)
            src = re.sub(r'(import\(\s*"\./[\w.-]+\.js)"', rf'\1?v={self.ver}"', src)
            f.write_text(src, encoding="utf-8")

    def quote_html(self, qid, compact=False):
        q = self.quotes["quotes"][qid]
        lines = " ".join(e(l) for l in q["lines"])
        cap = f'<a href="{attr(q["url"])}">{e(q["cite"])}</a>' + ("" if compact else f' · {e(q["title"])} · translated by {e(q["translator"])} (CC0)')
        return f'<figure class="quote"><blockquote>{lines}</blockquote><figcaption>{cap}</figcaption></figure>'

    def practice_source(self, f, p):
        if p["quote"] == f["def"]:
            q = self.quotes["quotes"][p["quote"]]
            return f'<p class="small">Grounded in the definition above (<a href="{attr(q["url"])}">{e(q["cite"])}</a>).</p>'
        return self.quote_html(p["quote"], compact=True)

    def chapter_pages(self):
        """The short book: an introduction and one chapter per factor; plus the sources page."""
        fs = self.factors["factors"]
        groups = self.factors["groups"]
        toc = "".join(f'<li><a href="{{{{root}}}}path/{f["slug"]}/"><b>{e(f["name"])}</b></a> <span class="small">({e(groups[f["group"]])})</span><br>{e(f["short"])}</li>' for f in fs)
        intro = f"""<p class="eyebrow">The path</p>
<h1>The Noble Eightfold Path</h1>
<p class="lede">The eightfold path is the Buddha's description of a way of life that leads beyond suffering. It is called the middle way: between indulgence and harsh self-denial.</p>
{self.quote_html("middle-way")}
{self.quote_html("middle-way-path")}
<h2>Eight factors, three kinds of training</h2>
<p>The factors are traditionally grouped into ethics, meditation (literally immersion) and wisdom. They aren't steps to take in order: they develop together, each supporting the others.</p>
{self.quote_html("three-spectrums")}
<h2>The chapters</h2>
<ol class="guide-list chapters">{toc}</ol>
<p>Each chapter gives the factor's definition from the discourses, a little plain commentary, related passages, three practices and questions for reflection. The quotations are Bhikkhu Sujato's translations, which are in the public domain; the commentary is this site's own, written to be modest, and corrections are welcome.</p>
<p class="btn-row"><a class="btn" href="{{{{root}}}}">Take the self-check</a></p>
"""
        self.pages.append(({"path": "path/", "title": "The Noble Eightfold Path, factor by factor, with sources | Eightfold Helper",
                            "description": "A short guide to the eight factors of the Noble Eightfold Path, quoting the early discourses (public-domain translations by Bhikkhu Sujato), with practices and questions for each.",
                            "og": "path", "nav": "path/", "source": "factors.json"}, intro))
        for i, f in enumerate(fs):
            prev_ = fs[i - 1] if i else None
            next_ = fs[i + 1] if i + 1 < len(fs) else None
            body = f"""<p class="eyebrow">Chapter {i + 1} of 8 · {e(groups[f["group"]])}</p>
<h1>{e(f["name"])} <span class="pali">{e(f["pali"])}</span></h1>
<p class="lede">{e(f["short"])}</p>
<h2>The definition</h2>
{self.quote_html(f["def"])}
<h2>In plain words</h2>
{"".join(f"<p>{e(p)}</p>" for p in f["chapter"])}
<p class="small">The commentary above is this site's own. The quotations are the source.</p>
<h2>From the discourses</h2>
{"".join(self.quote_html(q) for q in f["quotes"])}
<h2>Practices</h2>
{"".join(f'<div class="practice"><h3>{e(p["title"])}</h3><p>{e(p["steps"])}</p>{self.practice_source(f, p)}</div>' for p in f["practices"])}
<h2>Questions for reflection</h2>
<ul>{"".join(f"<li>{e(q)}</li>" for q in f["questions"])}</ul>
<nav class="pager" aria-label="Chapters">{f'<a href="../{prev_["slug"]}/">← {e(prev_["name"])}</a>' if prev_ else '<a href="../">← The path</a>'}{f'<a href="../{next_["slug"]}/">{e(next_["name"])} →</a>' if next_ else '<a href="{{root}}">Take the self-check →</a>'}</nav>
"""
            jsonld = [{"@context": "https://schema.org", "@type": "Article", "headline": f"{f['name']} ({f['pali']})",
                       "url": "{{site_url}}/path/" + f["slug"] + "/", "isPartOf": {"@type": "Book", "name": "The Noble Eightfold Path, factor by factor"},
                       "author": {"@type": "Organization", "name": "Eightfold Helper"}, "publisher": {"@type": "Organization", "name": "Eightfold Helper"},
                       "citation": [self.quotes["quotes"][q]["url"] for q in [f["def"], *f["quotes"]]]}]
            self.pages.append(({"path": f"path/{f['slug']}/", "title": f"{f['name']} ({f['pali']}): meaning, sources and practices | Eightfold Helper",
                                "description": f"What {f['name'].lower()} means in the early Buddhist discourses, with quotations, three practices and questions for reflection.",
                                "og": "path", "nav": "path/", "jsonld": jsonld, "source": "factors.json"}, body))
        rows = "".join(f'<tr><td>{e(q["cite"])}</td><td>{e(q["title"])}</td><td><a href="{attr(q["url"])}">SuttaCentral</a></td></tr>'
                       for q in sorted(self.quotes["quotes"].values(), key=lambda q: q["cite"]))
        sources = f"""<h1>Sources and license</h1>
<p class="lede">Every passage quoted on this site comes from Bhikkhu Sujato's English translations of the early Buddhist discourses, published by SuttaCentral and dedicated to the public domain under Creative Commons Zero (CC0).</p>
<p>The text is taken word for word from SuttaCentral's published translation data, by segment. A scheduled job checks every quotation against the source and the license each week; if Bhikkhu Sujato revises a passage, the site updates to match.</p>
<div class="table-wrap"><table><thead><tr><th scope="col">Citation</th><th scope="col">Discourse</th><th scope="col">Read in full</th></tr></thead><tbody>{rows}</tbody></table></div>
<h2>Abbreviations</h2>
<ul><li>DN: Long Discourses (Dīgha Nikāya)</li><li>MN: Middle Discourses (Majjhima Nikāya)</li><li>SN: Linked Discourses (Saṁyutta Nikāya)</li><li>AN: Numbered Discourses (Aṅguttara Nikāya)</li><li>Dhp: Sayings of the Dhamma (Dhammapada)</li><li>Snp: Anthology of Discourses (Sutta Nipāta)</li></ul>
<p>The numbers after the colon are SuttaCentral's segment numbers, so each quotation can be found exactly.</p>
<p>This site's own text (the commentary, practices and self-check) is © its contributors under the MIT license; see the <a href="{{{{repo_url}}}}">source code</a>.</p>
"""
        self.pages.append(({"path": "sources/", "title": "Sources and license: the discourses quoted | Eightfold Helper",
                            "description": "Every passage quoted on Eightfold Helper, with citations and links to the full discourses on SuttaCentral. Translations by Bhikkhu Sujato, public domain (CC0).",
                            "og": "path", "nav": "sources/", "source": "quotes.json"}, sources))

    def build(self):
        if self.out.exists():
            shutil.rmtree(self.out)
        self.out.mkdir(parents=True)
        self.assets()
        self.chapter_pages()
        for meta, body in self.pages:
            path = meta["path"]
            target = path if path.endswith(".html") else path + "index.html"
            self.write(target, self.layout(meta, body))
            if not meta.get("noindex") and path != "404.html":
                self.indexable.append(path)
        lastmod = self.today.isoformat()
        urls = "".join(f"<url><loc>{self.url(p)}</loc><lastmod>{lastmod}</lastmod></url>\n" for p in self.indexable)
        self.write("sitemap.xml", '<?xml version="1.0" encoding="UTF-8"?>\n'
                   f'<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n{urls}</urlset>\n')
        self.write("robots.txt", f"User-agent: *\nAllow: /\nSitemap: {self.site_url}/sitemap.xml\n")
        self.write(f"{INDEXNOW_KEY}.txt", INDEXNOW_KEY)
        self.write(".nojekyll", "")
        self.write("urls.txt", "".join(self.url(p) + "\n" for p in self.indexable))
        self.write("build.json", json.dumps({"commit": self.commit, "built": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
                                             "version": self.ver}) + "\n")
        return self


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=str(ROOT / "dist"))
    args = ap.parse_args()
    today = dt.date.fromisoformat(os.environ["BUILD_DATE"]) if os.environ.get("BUILD_DATE") else dt.datetime.now(dt.timezone.utc).date()
    site = Site(args.out, today).build()
    print(f"built {len(site.pages)} pages ({len(site.indexable)} in the sitemap) into {args.out}, version {site.ver}")


if __name__ == "__main__":
    main()
