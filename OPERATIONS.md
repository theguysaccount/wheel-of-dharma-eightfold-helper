# Operations

Eightfold Helper is a static site on GitHub Pages. The self-check runs in the visitor's browser and the pages make no network requests. GitHub Actions deploys it and checks it, including every quotation against its source. Nothing needs a person.

- **Live:** https://theguysaccount.github.io/wheel-of-dharma-eightfold-helper/
- **Repo:** https://github.com/theguysaccount/wheel-of-dharma-eightfold-helper
- **Base URL setting:** repository variable `SITE_URL` (unset = the github.io URL above)

## Automated jobs

| Job | Workflow | When | What it does | How it fails safe |
|---|---|---|---|---|
| Deploy | `pages.yml` | every push to `main`; on demand; when the self-test finds the live site behind `main` | Unit tests (scoring, focus, links, wheel; content: every cited passage exists and is CC0, every definition is SN 45.8's, no medical/therapeutic/messianic wording), build tests, build, the end-to-end run against the build, deploy, wait until live, the end-to-end run against the live site, IndexNow | Any failed test stops before deploy; the last good site stays live. |
| Weekly self-test | `selftest.yml` | Saturdays 10:53 UTC (plus a temporary line on 22–23 Nov 2026 to prove the trigger) | Unit tests; **sources**: every quotation re-fetched from SuttaCentral's published translation data and compared word for word, and every collection's license checked to still be CC0: a revised passage is updated and committed after the tests pass; the end-to-end run on the **live** site (quick and full checks, wheel, focus practices with quotations, shared link, history, every chapter, no console errors, no network requests, no phone overflow); every page, file and cited link; **staleness**: redeploys when the live build is older than `main` | A license change or a vanished passage fails the run without changing anything. A failure opens or comments on one `ops-alert` issue (GitHub emails the owner); the next pass closes it. Safe to re-run any time. |
| Keep-alive | `selftest.yml` → `scripts/keepalive.sh` | with every self-test | Re-enables the scheduled workflow; an empty `[skip ci]` commit after 45 quiet days | Without it GitHub disables the schedule after 60 days with no commits. |

**After the first scheduled run passes, remove the temporary cron line** (`49 */4 22,23 11 *`) from `selftest.yml`.

## What to watch

- Open `ops-alert` issues and red runs.
- **Revised translations.** Bhikkhu Sujato's revision is ongoing. When a quoted segment changes, the self-test updates `site/data/quotes.json` and commits it ("Quotations updated to match the source's current wording"); skim those commits to check the passage still fits where it's used.
- **Respect.** The tests block medical and therapeutic wording, Maitreya claims, and "fixing" or "true" Buddhism language in the site's own text. Keep it that way; the brief flags religious sensitivity as a risk.

## Run anything by hand

```bash
node --test tests/js/*.test.mjs && python3 -m unittest discover -s tests
python3 pipeline/sources.py --verify        # or --update to pull revised wording
python3 pipeline/build.py && node scripts/e2e.mjs
node scripts/e2e.mjs https://theguysaccount.github.io/wheel-of-dharma-eightfold-helper/
python3 scripts/check_live.py https://theguysaccount.github.io/wheel-of-dharma-eightfold-helper
~/.local/bin/gh workflow run pages.yml -R theguysaccount/wheel-of-dharma-eightfold-helper
~/.local/bin/gh workflow run selftest.yml -R theguysaccount/wheel-of-dharma-eightfold-helper
```

## Keys Jack can turn later

### 1. Custom domain

Handled by the domain rollout session. The brief's production domain is **effectivebuddhism.com** (Jack's portfolio). **Something may already be live there:** on 22 Nov 2026 public DNS (dns.google) showed nameservers `ns1/ns2.siteground.net` and an A record `75.2.60.5` (a Netlify load-balancer address); an HTTPS request to it from Jack's Mac was reset, so what it serves is unknown. Check it before changing anything (never replace what exists). The notes also mention `wheelofdharma.org` and `efffectivebuddhism.com` (three f's, likely a typo); ownership unconfirmed. `eightfoldhelper.com` and `.org` are unregistered.

Steps for a domain `D` (apex) once it's confirmed free to use:
1. DNS: `A @` → `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153`; `AAAA @` → `2606:50c0:8000::153`, `2606:50c0:8001::153`, `2606:50c0:8002::153`, `2606:50c0:8003::153`; `CNAME www` → `theguysaccount.github.io`. For a subdomain (for example `helper.effectivebuddhism.com`, which leaves the apex untouched): one `CNAME` → `theguysaccount.github.io`.
2. `~/.local/bin/gh api -X PUT repos/theguysaccount/wheel-of-dharma-eightfold-helper/pages -f cname=D`, wait for the certificate, then `~/.local/bin/gh api -X PUT repos/theguysaccount/wheel-of-dharma-eightfold-helper/pages -F https_enforced=true`.
3. `~/.local/bin/gh variable set SITE_URL -R theguysaccount/wheel-of-dharma-eightfold-helper --body https://D`, then `~/.local/bin/gh workflow run pages.yml -R theguysaccount/wheel-of-dharma-eightfold-helper`.
4. Shared result links keep working (github.io redirects with the `#…` part). Earlier checks saved in browsers stay at the old address.

### 2. Review by a teacher (needs a human)

The brief asks for doctrine to be checked with scholars. The site quotes the discourses for every definition and keeps its own commentary short and labelled, but no teacher has reviewed it. A reviewer's corrections go straight into `site/data/factors.json`; credit them on the About page if they wish.

### 3. Money

Free and ad-free. Slot: a small "Support this site" box on the home page, hidden until `SUPPORT_URL` is set (GitHub Sponsors needs the account owner's bank and tax details; or a donation page elsewhere). `~/.local/bin/gh variable set SUPPORT_URL -R theguysaccount/wheel-of-dharma-eightfold-helper --body https://…` and redeploy. The brief's book could later be sold as an ebook on other hosting.

### 4. Analytics (activation metric)

Off by default. Activation = `event/check_done/<quick|full>`; share loop = `event/result_open`; also `check_start/…`, `share_copy`. Set `GOATCOUNTER_URL` and redeploy; the build adds that one origin to the security policy.

### 5. Search Console

Verify the domain once one is live and submit `/sitemap.xml`. IndexNow runs on every deploy; the account-root robots.txt lists this sitemap.

### 6. More passages (content routine)

A quarterly Claude routine can deepen chapters: "In ~/code/wheel-of-dharma-eightfold-helper, add one or two well-known passages per factor to site/data/sources.json (Bhikkhu Sujato's translations only, segment ids from bilara-data), run `python3 pipeline/sources.py`, reference them in factors.json, keep commentary plain and modest, run all tests and `node scripts/e2e.mjs`, commit, push."
