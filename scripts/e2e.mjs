// End-to-end test of the real pages in headless Chrome.
//   node scripts/e2e.mjs                 # serve dist/ locally and test it
//   node scripts/e2e.mjs https://host/x/ # test a live site
//   node scripts/e2e.mjs --screens [url] # also save screenshots to docs/screens/
// Takes the quick check and the full check through the real page, checks the wheel, the focus
// practices and their quoted passages, reopens a shared result, sees earlier checks listed, reads
// every chapter, and fails on console errors, network requests or phone-width overflow.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launch, serve, sleep } from "./cdp.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const F = JSON.parse(fs.readFileSync(path.join(ROOT, "site/data/factors.json"), "utf8"));
const args = process.argv.slice(2);
const screens = args.includes("--screens");
let base = args.find((a) => !a.startsWith("--"));
let server = null;
if (!base) {
  server = await serve(path.join(ROOT, "dist"));
  base = server.url;
}
if (!base.endsWith("/")) base += "/";
const origin = new URL(base).origin;
const shot = (page, name, opts) => (screens ? page.screenshot(path.join(ROOT, "docs", "screens", `${name}.png`), opts) : null);
const log = (...m) => console.log(...m);

const browser = await launch();
const failures = [];
async function step(name, fn) {
  const t0 = Date.now();
  try {
    await fn();
    log(`ok   ${name} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  } catch (e) {
    failures.push(`${name}: ${e.message}`);
    log(`FAIL ${name}: ${e.stack || e.message}`);
  }
}

const page = await browser.newPage();
await page.viewport(1280, 900);
let fullLink = "";

await step("home: both checks are offered, with the limits stated first", async () => {
  await page.goto(base);
  await page.eval("localStorage.clear()");
  await page.goto(base);
  assert.match(await page.eval("document.querySelector('h1').textContent"), /path need your attention/);
  assert.match(await page.eval("document.querySelector('.limits').textContent"), /not a measure of spiritual progress/);
  await shot(page, "home-desktop", { fullPage: true });
});

await step("quick check: unticked factors become the starting points, with quoted practices", async () => {
  await page.click("#go-quick");
  await page.waitFor("!document.querySelector('#quick').hidden", "the quick check");
  assert.equal(await page.eval("document.querySelectorAll('#quick-list input').length"), 8);
  // Tick everything except speech (2) and livelihood (4).
  await page.eval("[...document.querySelectorAll('#quick-list input')].forEach((x, i) => { if (![2, 4].includes(i)) x.click(); })");
  await page.click("#quick-done");
  await page.waitFor("document.body.dataset.result === 'quick'", "the result");
  assert.equal(await page.eval("document.body.dataset.focus"), "speech,livelihood");
  assert.equal(await page.eval("document.querySelectorAll('.focus-card').length"), 2);
  const card = await page.eval("document.querySelector('.focus-card').textContent");
  assert.match(card, /Right speech/);
  assert.match(card, /Refraining from speech that’s false, backbiting, harsh, or nonsensical/, "the definition is quoted word for word");
  const links = await page.eval("[...document.querySelectorAll('.focus-card figcaption a')].map(a => a.href)");
  assert.ok(links.length >= 4 && links.every((u) => u.startsWith("https://suttacentral.net/")), JSON.stringify(links));
  assert.equal(await page.eval("document.querySelectorAll('.wheel path.fill').length"), 8, "every factor has a filled spoke");
  assert.match(await page.eval("document.querySelector('#share-link').value"), /#q=11010111$/);
  await shot(page, "result-quick-desktop", { fullPage: true });
});

await step("full check: every statement answered through the page; the two lowest factors are suggested", async () => {
  await page.click("[data-restart]");
  await page.click("#go-full");
  await page.waitFor("!document.querySelector('#full').hidden", "the full check");
  const total = F.factors.reduce((a, f) => a + f.statements.length, 0);
  assert.equal(await page.eval("document.querySelectorAll('fieldset.statement').length"), total);
  assert.equal(await page.eval("document.querySelector('#full-done').disabled"), true, "can't finish half-way");
  // Answer 4 everywhere, except right effort (2) and right concentration (3).
  await page.eval(`(() => { for (const fs of document.querySelectorAll('fieldset.statement')) {
    const name = fs.querySelector('input').name;
    const v = name.startsWith('effort.') ? 2 : name.startsWith('concentration.') ? 3 : 4;
    fs.querySelector('input[value="' + v + '"]').click();
  } })()`);
  await page.waitFor("!document.querySelector('#full-done').disabled", "the finish button");
  await page.click("#full-done");
  await page.waitFor("document.body.dataset.result === 'full'", "the result");
  assert.equal(await page.eval("document.body.dataset.focus"), "effort,concentration");
  assert.match(await page.eval("document.querySelector('#result-lead').textContent"), /right effort and right concentration/);
  fullLink = await page.eval("document.querySelector('#share-link').value");
  assert.match(fullLink, /#r=4040404040204030$/);
  assert.ok(await page.eval("document.querySelector('.wheel').getAttribute('aria-label').includes('Right effort, sometimes')"));
  await shot(page, "result-full-desktop", { fullPage: true });
});

await step("earlier checks are listed, and a shared link shows the same result", async () => {
  assert.equal(await page.eval("document.querySelector('#history-wrap').hidden"), false);
  assert.equal(await page.eval("document.querySelectorAll('#history li').length"), 1);
  const other = await browser.newPage();
  await other.goto(base + fullLink.slice(fullLink.indexOf("#")));
  await other.waitFor("document.body.dataset.result === 'full'", "the shared result");
  assert.equal(await other.eval("document.body.dataset.focus"), "effort,concentration");
  assert.equal(await other.eval("document.querySelector('#shared-note').hidden"), false);
  await other.goto(base + "#r=nonsense");
  await other.waitFor("!document.querySelector('#start').hidden", "the start page for a broken link");
});

await step("chapters: each quotes its definition, links its sources, and pages to the next", async () => {
  for (const [i, f] of F.factors.entries()) {
    await page.goto(base + `path/${f.slug}/`, { wait: "main" });
    const text = await page.eval("document.querySelector('main').textContent");
    assert.ok(text.includes(`And what is ${f.rendering}?`), `${f.slug}: the definition`);
    assert.ok(await page.eval("document.querySelectorAll('figure.quote').length") >= 4, `${f.slug}: quotations`);
    const next = await page.eval("[...document.querySelectorAll('.pager a')].map(a => a.getAttribute('href')).join(' ')");
    if (i < 7) assert.ok(next.includes(F.factors[i + 1].slug), `${f.slug}: next chapter`);
  }
  await page.goto(base + "sources/", { wait: "main" });
  assert.ok(await page.eval("document.querySelectorAll('tbody tr').length") >= 30);
  await shot(page, "chapter-desktop");
});

await step("every page: canonical, no console errors, no requests to other sites", async () => {
  const robots = await (await fetch(base + "robots.txt")).text();
  const site = robots.match(/Sitemap: (\S+)\/sitemap\.xml/)[1];
  const urls = [...(await (await fetch(base + "sitemap.xml")).text()).matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  assert.ok(urls.length >= 12, "sitemap lists the pages");
  for (const u of urls) {
    await page.goto(base + u.slice(site.length + 1), { wait: "main" });
    assert.equal(await page.eval("document.querySelector('link[rel=canonical]').href"), u);
  }
  const foreign = page.requests.filter((u) => !u.startsWith(origin) && !u.startsWith("data:") && !u.startsWith("blob:"));
  assert.deepEqual(foreign, [], "requests to other sites");
  assert.deepEqual(page.errors, [], "console errors");
});

await step("phone width: no page scrolls sideways, results included", async () => {
  const phone = await browser.newPage();
  await phone.viewport(390, 844, true);
  const wide = [];
  for (const t of ["", "path/", "path/right-mindfulness/", "sources/", "about/", fullLink.slice(fullLink.indexOf("#"))]) {
    await phone.goto(base + t, { wait: "main" });
    await sleep(150);
    const w = await phone.eval("document.documentElement.scrollWidth");
    if (w > 391) wide.push(`${t || "home"}: ${w}px`);
    if (screens && t.startsWith("#")) await phone.screenshot(path.join(ROOT, "docs", "screens", "result-phone.png"), { fullPage: true });
  }
  await phone.goto(base);
  await phone.click("#go-full");
  await sleep(200);
  const w = await phone.eval("document.documentElement.scrollWidth");
  if (w > 391) wide.push(`full check: ${w}px`);
  if (screens) await phone.screenshot(path.join(ROOT, "docs", "screens", "check-phone.png"));
  assert.deepEqual(wide, []);
  assert.deepEqual(phone.errors, []);
});

await browser.close();
if (server) await server.close();
if (failures.length) {
  log(`\n${failures.length} failed:\n  ${failures.join("\n  ")}`);
  process.exit(1);
}
log(`\nall end-to-end checks passed on ${base}`);
