// Unit tests: scoring, focus, result links, wheel geometry, and the integrity of the content.
// Run: node --test tests/js/*.test.mjs   (no network needed)
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { scoreFull, scoreQuick, focus, encodeResult, decodeResult, wedge, point, radiusFor, label } from "../../site/assets/core.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const F = JSON.parse(fs.readFileSync(path.join(ROOT, "site/data/factors.json"), "utf8"));
const Q = JSON.parse(fs.readFileSync(path.join(ROOT, "site/data/quotes.json"), "utf8")).quotes;
const S = JSON.parse(fs.readFileSync(path.join(ROOT, "site/data/sources.json"), "utf8"));
const FACTORS = F.factors;

test("the eight factors are present, in the traditional order, in their three groups", () => {
  assert.deepEqual(FACTORS.map((f) => f.id), ["view", "intention", "speech", "action", "livelihood", "effort", "mindfulness", "concentration"]);
  assert.deepEqual(FACTORS.map((f) => f.group), ["wisdom", "wisdom", "ethics", "ethics", "ethics", "immersion", "immersion", "immersion"]);
  assert.equal(new Set(FACTORS.map((f) => f.slug)).size, 8);
});

test("every factor is defined by the Analysis discourse, and every passage cited exists, word for word, under CC0", () => {
  for (const f of FACTORS) {
    assert.match(Q[f.def].cite, /^SN 45\.8:/, f.id);
    assert.ok(Q[f.def].lines.some((l) => l.toLowerCase().includes(`what is ${f.rendering}`)), `${f.id} definition names the factor`);
    for (const id of [f.def, ...f.quotes, ...f.practices.map((p) => p.quote)]) {
      assert.ok(Q[id], `${f.id}: quote ${id} is missing`);
      assert.ok(S.quotes[id], `${f.id}: quote ${id} isn't in sources.json`);
    }
  }
  for (const [id, q] of Object.entries(Q)) {
    assert.equal(q.license, "CC0", id);
    assert.ok(q.lines.length >= 1 && q.lines.every((l) => l.length > 0), id);
    assert.match(q.url, /^https:\/\/suttacentral\.net\/[a-z0-9.-]+\/en\/sujato$/, id);
    assert.ok(!q.lines.some((l) => l.includes("<j>")), `${id}: verse markers removed`);
  }
  assert.deepEqual(Object.keys(Q).sort(), Object.keys(S.quotes).sort(), "quotes.json matches the catalogue");
});

test("the self-check is balanced: three or four statements per factor, three practices, three questions", () => {
  for (const f of FACTORS) {
    assert.ok(f.statements.length >= 3 && f.statements.length <= 4, f.id);
    assert.equal(f.practices.length, 3, f.id);
    assert.equal(f.questions.length, 3, f.id);
    assert.ok(f.chapter.length >= 2, f.id);
  }
  assert.equal(F.scale.length, 5);
});

test("the site's own words make no medical, therapeutic or messianic claims and don't talk down to traditions", () => {
  const own = JSON.stringify(FACTORS.map((f) => ({ s: f.short, st: f.statements, c: f.chapter, p: f.practices.map((p) => [p.title, p.steps]), q: f.questions })));
  const banned = /\b(heal\w*|cure\w*|therap\w*|treat(ment)?s?|anxiety|depress\w*|disorder|diagnos\w*|clinical|maitreya|enlighten(ed|ment) guaranteed|fix(es|ing)? buddhism|correct(s|ing)? buddhism|true buddhism|real buddhism|guarantee\w*)\b/i;
  assert.equal(banned.exec(own), null, String(banned.exec(own)));
});

test("full check: a factor's score is the average of its statements", () => {
  const answers = {};
  FACTORS.forEach((f, fi) => f.statements.forEach((_, i) => { answers[`${f.id}.${i}`] = ((fi + i) % 5) + 1; }));
  const scores = scoreFull(FACTORS, answers);
  FACTORS.forEach((f, fi) => {
    const vals = f.statements.map((_, i) => ((fi + i) % 5) + 1);
    assert.equal(scores[fi], vals.reduce((a, b) => a + b, 0) / vals.length);
  });
  assert.deepEqual(scoreFull(FACTORS, {}), Array(8).fill(null));
  assert.equal(scoreFull(FACTORS, { "view.0": 9, "view.1": 0, "view.2": 3 })[0], 3, "out-of-range answers are ignored");
});

test("focus: the lowest factors below steady, ties to the earlier factor, never a steady one", () => {
  assert.deepEqual(focus([5, 2, 4, 2, 5, 3, 5, 5]), [1, 3]);
  assert.deepEqual(focus([3, 3, 3, 3, 3, 3, 3, 3], 3), [0, 1, 2], "ties go to right view first");
  assert.deepEqual(focus([5, 5, 5, 5, 4.5, 5, 5, 5]), [], "everything steady: nothing to fix");
  assert.deepEqual(focus([4.4, 5, 5, 5, 5, 5, 5, 5]), [0]);
  assert.deepEqual(focus([null, 1, 5, 5, 5, 5, 5, 5]), [1], "unanswered factors aren't picked");
  assert.deepEqual(focus(scoreQuick([true, false, true, false, false, true, true, true]), 3), [1, 3, 4]);
});

test("result links carry only the scores and round-trip", () => {
  const scores = [1, 2.5, 3.33, 4, 5, 1.67, 4.75, 3];
  const frag = encodeResult("full", scores);
  assert.match(frag, /^r=\d{16}$/);
  const back = decodeResult("#" + frag);
  assert.equal(back.mode, "full");
  assert.deepEqual(back.scores, scores.map((s) => Math.round(s * 10) / 10));
  const quick = scoreQuick([true, false, true, true, false, false, true, false]);
  const q = decodeResult(encodeResult("quick", quick));
  assert.deepEqual(q, { mode: "quick", scores: quick });
  for (const bad of ["", "#r=12", "#r=99999999999999999999", "#r=6060606060606060", "#q=1010", "#q=10a01010", "#x=1"]) assert.equal(decodeResult(bad), null, bad);
  assert.equal(decodeResult("#r=0010101010101010").scores[0], null, "an unanswered factor survives the link");
});

test("the wheel's geometry is sound", () => {
  assert.deepEqual(point(100, 100, 50, 0), [100, 50], "0 degrees is straight up");
  assert.deepEqual(point(100, 100, 50, 90), [150, 100], "90 degrees is to the right");
  assert.equal(radiusFor(1, 30, 130), 30);
  assert.equal(radiusFor(5, 30, 130), 130);
  assert.equal(radiusFor(3, 30, 130), 80);
  assert.equal(radiusFor(null, 30, 130), 30);
  const d = wedge(180, 180, 34, 138, -21, 21);
  assert.match(d, /^M[\d.]+ [\d.]+L[\d.]+ [\d.]+A138 138 0 0 1 [\d.]+ [\d.]+L[\d.]+ [\d.]+A34 34 0 0 0 [\d.]+ [\d.]+Z$/);
  assert.equal(label(4.6, F.scale), "almost always");
  assert.equal(label(1, F.scale), "rarely");
  assert.equal(label(null, F.scale), "not answered");
});
