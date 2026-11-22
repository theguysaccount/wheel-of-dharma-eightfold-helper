// Eightfold Helper core: scoring a self-check, choosing what to focus on, result links, and the
// wheel's geometry. No DOM; the same file runs in the browser and in the Node tests.

export const MIN = 1;
export const MAX = 5;
const STEADY = 4.5; // a factor scoring at least this is treated as steady

/** Average of each factor's answered statements (1-5), or null where nothing was answered. */
export function scoreFull(factors, answers) {
  return factors.map((f) => {
    const vals = f.statements.map((_, i) => answers[`${f.id}.${i}`]).filter((v) => Number.isInteger(v) && v >= MIN && v <= MAX);
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  });
}

/** Quick check: a ticked factor ("I feel steady here") counts as steady, an unticked one as not. */
export function scoreQuick(steady) {
  return steady.map((s) => (s ? MAX : 2));
}

/**
 * The factors to focus on: the lowest scores, up to `limit`, in the path's traditional order when
 * scores tie. Steady factors are never chosen. Returns factor indexes.
 */
export function focus(scores, limit = 2) {
  return scores
    .map((s, i) => ({ s, i }))
    .filter((x) => x.s !== null && x.s < STEADY)
    .sort((a, b) => a.s - b.s || a.i - b.i)
    .slice(0, limit)
    .map((x) => x.i);
}

// ---------- result links ----------

/** "#r=3045..." for a full check (two digits per factor: the average × 10), "#q=10110011" for a quick one. */
export function encodeResult(mode, scores) {
  if (mode === "quick") return `q=${scores.map((s) => (s >= STEADY ? 1 : 0)).join("")}`;
  return `r=${scores.map((s) => String(Math.round((s ?? 0) * 10)).padStart(2, "0")).join("")}`;
}

/** The scores and mode in a result link, or null if it isn't a valid one. */
export function decodeResult(fragment, count = 8) {
  const q = new URLSearchParams(String(fragment || "").replace(/^#/, ""));
  if (q.has("q")) {
    const v = q.get("q");
    if (!new RegExp(`^[01]{${count}}$`).test(v)) return null;
    return { mode: "quick", scores: scoreQuick([...v].map((c) => c === "1")) };
  }
  if (q.has("r")) {
    const v = q.get("r");
    if (!new RegExp(`^\\d{${count * 2}}$`).test(v)) return null;
    const scores = [];
    for (let i = 0; i < count; i++) {
      const n = Number(v.slice(i * 2, i * 2 + 2));
      if (n !== 0 && (n < MIN * 10 || n > MAX * 10)) return null;
      scores.push(n === 0 ? null : n / 10);
    }
    return { mode: "full", scores };
  }
  return null;
}

// ---------- the wheel ----------

/** Polar to cartesian, with 0 degrees at the top and angles growing clockwise. */
export function point(cx, cy, r, deg) {
  const a = ((deg - 90) * Math.PI) / 180;
  return [Math.round((cx + r * Math.cos(a)) * 100) / 100, Math.round((cy + r * Math.sin(a)) * 100) / 100];
}

/** An SVG path for a wedge (one spoke's share of the wheel) from r0 to r1 between two angles. */
export function wedge(cx, cy, r0, r1, a0, a1) {
  const [x0, y0] = point(cx, cy, r1, a0);
  const [x1, y1] = point(cx, cy, r1, a1);
  const [x2, y2] = point(cx, cy, r0, a1);
  const [x3, y3] = point(cx, cy, r0, a0);
  const large = a1 - a0 > 180 ? 1 : 0;
  return `M${x3} ${y3}L${x0} ${y0}A${r1} ${r1} 0 ${large} 1 ${x1} ${y1}L${x2} ${y2}A${r0} ${r0} 0 ${large} 0 ${x3} ${y3}Z`;
}

/** Radius for a score: the hub for the lowest, the rim for the highest. */
export const radiusFor = (score, hub, rim) => (score === null ? hub : hub + ((score - MIN) / (MAX - MIN)) * (rim - hub));

/** A word for a score, for screen readers and the list. */
export function label(score, scale) {
  if (score === null) return "not answered";
  return scale[Math.min(scale.length - 1, Math.max(0, Math.round(score) - 1))].toLowerCase();
}
