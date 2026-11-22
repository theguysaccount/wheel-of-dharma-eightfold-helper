"""Health check of the live site. Standard library only.

    python3 scripts/check_live.py https://theguysaccount.github.io/wheel-of-dharma-eightfold-helper
    python3 scripts/check_live.py URL --wait-for COMMIT   # after a deploy: wait until that commit is live

Checks that robots.txt names this site's sitemap, every sitemap page answers 200 with its own
canonical URL and the no-network security policy, every file the pages load answers 200, and every
cited source still resolves. It also compares the live build with this checkout: when the live site
was built from older site code than main has, it writes stale=true to $GITHUB_OUTPUT so the workflow
can redeploy. Exits 1 on any failure. Sites that refuse automated requests (403/429) are warnings.
"""
import argparse
import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urljoin, urlparse

ROOT = Path(__file__).resolve().parent.parent
REPO_URL = "https://github.com/theguysaccount/wheel-of-dharma-eightfold-helper"
UA = f"EightfoldHelperHealthCheck/1.0 (+{REPO_URL})"
BUILD_INPUTS = ["site", "pipeline"]  # what the deployed files are made from


def get(url, timeout=30):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Cache-Control": "no-cache"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.status, r.read().decode("utf-8", errors="replace")


class Links(HTMLParser):
    def __init__(self):
        super().__init__()
        self.links, self.assets, self.canonical, self.csp = [], [], None, None

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == "a" and a.get("href"):
            self.links.append(a["href"])
        elif tag == "link" and a.get("rel") == "canonical":
            self.canonical = a.get("href")
        elif tag == "link" and a.get("rel") in ("stylesheet", "icon"):
            self.assets.append(a["href"])
        elif tag in ("script", "img") and a.get("src"):
            self.assets.append(a["src"])
        elif tag == "meta" and a.get("http-equiv", "").lower() == "content-security-policy":
            self.csp = a.get("content", "")


def live_commit(base):
    status, body = get(f"{base}/build.json?t={int(time.time())}")
    return json.loads(body).get("commit", "")


def wait_for(base, commit, minutes=10):
    deadline = time.time() + minutes * 60
    while time.time() < deadline:
        try:
            if live_commit(base) == commit:
                print(f"live site is on {commit[:7]}")
                return 0
        except Exception as e:  # noqa: BLE001 - keep waiting through hiccups
            print(f"waiting: {e}")
        time.sleep(15)
    print(f"::error::the live site didn't reach {commit[:7]} within {minutes} minutes")
    return 1


def stale_check(base, problems, warnings):
    """True when main has build inputs the live site doesn't. Never fails the run by itself."""
    try:
        live = live_commit(base)
    except Exception as e:  # noqa: BLE001
        problems.append(f"build.json: {e}")
        return False
    if not re.fullmatch(r"[0-9a-f]{40}", live or ""):
        warnings.append(f"live build.json has no commit ({live!r})")
        return True
    known = subprocess.run(["git", "cat-file", "-e", f"{live}^{{commit}}"], cwd=ROOT, capture_output=True).returncode == 0
    if not known:
        warnings.append(f"live commit {live[:7]} isn't in this checkout's history")
        return True
    changed = subprocess.run(["git", "diff", "--quiet", live, "HEAD", "--", *BUILD_INPUTS], cwd=ROOT).returncode != 0
    print(f"live build: {live[:7]}; main {'has newer site code' if changed else 'matches it'}")
    return changed


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("base")
    ap.add_argument("--wait-for")
    ap.add_argument("--no-external", action="store_true")
    args = ap.parse_args()
    base = args.base.rstrip("/")
    if args.wait_for:
        return wait_for(base, args.wait_for)

    problems, warnings = [], []
    host = urlparse(base).netloc
    robots = get(f"{base}/robots.txt")[1]
    if f"Sitemap: {base}/sitemap.xml" not in robots:
        problems.append(f"robots.txt doesn't name {base}/sitemap.xml")
    urls = re.findall(r"<loc>([^<]+)</loc>", get(f"{base}/sitemap.xml")[1])
    if len(urls) < 10:
        problems.append(f"the sitemap lists only {len(urls)} pages")
    external, assets = set(), set()
    for u in urls:
        try:
            status, page = get(u)
        except Exception as e:  # noqa: BLE001
            problems.append(f"{u}: {e}")
            continue
        p = Links()
        p.feed(page)
        if p.canonical != u:
            problems.append(f"{u}: canonical is {p.canonical}")
        if not p.csp or "connect-src 'none'" not in p.csp and "goatcounter" not in p.csp:
            problems.append(f"{u}: the no-network security policy is missing")
        if "{{" in page:
            problems.append(f"{u}: unfilled placeholder")
        for href in p.links:
            full = urljoin(u, href).split("#")[0]
            if urlparse(full).scheme in ("http", "https") and urlparse(full).netloc != host:
                external.add(full)
        for src in p.assets:
            full = urljoin(u, src)
            if urlparse(full).netloc == host:
                assets.add(full)
    for a in sorted(assets):
        try:
            get(a)
        except Exception as e:  # noqa: BLE001
            problems.append(f"{a}: {e}")
    print(f"checked {len(urls)} pages and {len(assets)} files")

    if not args.no_external:
        for link in sorted(external):
            if link.startswith(REPO_URL):
                continue
            try:
                time.sleep(1)
                get(link, timeout=25)
            except urllib.error.HTTPError as e:
                (warnings if e.code in (401, 403, 429) or e.code >= 500 else problems).append(f"cited link {link}: HTTP {e.code}")
            except Exception as e:  # noqa: BLE001
                warnings.append(f"cited link {link}: {e}")
        print(f"checked {len(external)} cited links")

    stale = stale_check(base, problems, warnings)
    out = os.environ.get("GITHUB_OUTPUT")
    if out:
        with open(out, "a") as f:
            f.write(f"stale={'true' if stale else 'false'}\n")
    for w in warnings:
        print(f"::warning::{w}")
    for p in problems:
        print(f"::error::{p}")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
