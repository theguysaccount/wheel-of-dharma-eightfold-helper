// The self-check. Answers stay in this browser; a result link carries only the eight scores.
import { scoreFull, scoreQuick, focus, encodeResult, decodeResult, wedge, point, radiusFor, label } from "./core.js";
import { CFG, $, h, svg, track, copyText } from "./common.js";

const F = JSON.parse(document.getElementById("factors").textContent);
const Q = JSON.parse(document.getElementById("quotes").textContent).quotes;
const FACTORS = F.factors;
const HISTORY_KEY = "eightfold.history.v1";
const answers = {};

function show(id) {
  for (const s of ["#start", "#quick", "#full", "#result"]) $(s).hidden = s !== id;
  window.scrollTo(0, 0);
}

// ---------- a quoted passage ----------

export function quoteBlock(id, { compact = false } = {}) {
  const q = Q[id];
  return h("figure", { class: "quote" },
    h("blockquote", {}, ...q.lines.map((l) => h("span", { class: "ql" }, l, " "))),
    h("figcaption", {}, h("a", { href: q.url, rel: "noopener" }, q.cite), compact ? "" : ` · ${q.title} · translated by ${q.translator} (CC0)`));
}

// ---------- the checks ----------

function renderQuick() {
  $("#quick-list").replaceChildren(...FACTORS.map((f, i) => h("label", { class: "tick" },
    h("input", { type: "checkbox", name: "steady", value: String(i) }),
    h("span", {}, h("b", {}, f.name), h("span", { class: "small" }, f.short)))));
}

function renderFull() {
  let n = 0;
  const total = FACTORS.reduce((a, f) => a + f.statements.length, 0);
  $("#full-list").replaceChildren(...FACTORS.map((f) => h("section", { class: "factor-block" },
    h("h2", {}, f.name),
    ...f.statements.map((text, i) => {
      n++;
      const id = `${f.id}.${i}`;
      return h("fieldset", { class: "statement" },
        h("legend", {}, h("span", { class: "num" }, `${n} of ${total}`), text),
        h("div", { class: "scale" }, ...F.scale.map((word, k) => h("label", {},
          h("input", { type: "radio", name: id, value: String(k + 1), onchange: () => { answers[id] = k + 1; progress(total); } }),
          h("span", {}, word)))));
    }))));
  progress(total);
}

function progress(total) {
  const done = Object.keys(answers).length;
  $("#full-progress").textContent = `${done} of ${total} answered`;
  $("#full-done").disabled = done < total;
  $("#full-hint").hidden = done >= total;
}

// ---------- the result ----------

const GROUP_CLASS = { wisdom: "g-wisdom", ethics: "g-ethics", immersion: "g-immersion" };

function wheel(scores) {
  const S = 360, c = S / 2, hub = 34, rim = 138;
  const root = svg("svg", { viewBox: `0 0 ${S} ${S}`, class: "wheel", role: "img" });
  root.append(svg("circle", { cx: c, cy: c, r: rim, class: "rim-bg" }));
  FACTORS.forEach((f, i) => {
    const a0 = i * 45 - 22.5 + 1.5;
    const a1 = i * 45 + 22.5 - 1.5;
    const r = radiusFor(scores[i], hub, rim);
    root.append(svg("path", { d: wedge(c, c, hub, rim, a0, a1), class: "slot" }));
    if (r > hub) root.append(svg("path", { d: wedge(c, c, hub, r, a0, a1), class: `fill ${GROUP_CLASS[f.group]}` }));
    const [lx, ly] = point(c, c, rim + 14, i * 45);
    const anchor = i === 0 || i === 4 ? "middle" : i < 4 ? "start" : "end";
    root.append(svg("text", { x: lx, y: ly + (i === 4 ? 10 : i === 0 ? -2 : 4), "text-anchor": anchor, class: "wlabel" }, f.name.replace("Right ", "")));
  });
  for (let i = 0; i < 8; i++) {
    const [x, y] = point(c, c, rim, i * 45 + 22.5);
    root.append(svg("line", { x1: c, y1: c, x2: x, y2: y, class: "spoke" }));
  }
  root.append(svg("circle", { cx: c, cy: c, r: rim, class: "rim" }), svg("circle", { cx: c, cy: c, r: hub, class: "hub" }));
  root.setAttribute("aria-label", "Your wheel: " + FACTORS.map((f, i) => `${f.name}, ${label(scores[i], F.scale)}`).join("; "));
  return root;
}

function practiceCard(f) {
  return h("article", { class: "focus-card" },
    h("h3", {}, f.name, h("span", { class: "pali" }, ` · ${f.pali}`)),
    quoteBlock(f.def),
    h("p", {}, "Three practices to try, one at a time:"),
    ...f.practices.map((p) => h("div", { class: "practice" },
      h("h4", {}, p.title),
      h("p", {}, p.steps),
      p.quote === f.def
        ? h("p", { class: "small" }, "Grounded in the definition above (", h("a", { href: Q[p.quote].url, rel: "noopener" }, Q[p.quote].cite), ").")
        : quoteBlock(p.quote, { compact: true }))),
    h("p", {}, h("a", { href: `${CFG.root}path/${f.slug}/` }, `Read the chapter on ${f.name.toLowerCase()} →`)));
}

function saveHistory(mode, scores) {
  try {
    const list = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]").filter((x) => x && x.frag);
    list.unshift({ date: new Date().toISOString().slice(0, 10), frag: encodeResult(mode, scores) });
    localStorage.setItem(HISTORY_KEY, JSON.stringify(list.slice(0, 20)));
  } catch { /* storage off: nothing kept */ }
}

function renderHistory() {
  let list = [];
  try {
    list = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]").filter((x) => x && x.frag && decodeResult(x.frag));
  } catch { /* nothing */ }
  $("#history-wrap").hidden = list.length < 2;
  $("#history").replaceChildren(...list.slice(1, 6).map((x) => h("li", {}, h("a", { href: "#" + x.frag }, `${x.date}: ${decodeResult(x.frag).mode === "quick" ? "quick check" : "full check"}`))));
}

function showResult(mode, scores, { shared = false } = {}) {
  const picks = focus(scores, mode === "quick" ? 3 : 2);
  $("#result-wheel").replaceChildren(wheel(scores));
  $("#result-list").replaceChildren(...FACTORS.map((f, i) => h("li", { class: picks.includes(i) ? "picked" : "" },
    h("span", { class: `dot ${GROUP_CLASS[f.group]}` }), h("b", {}, f.name), " ",
    h("span", { class: "small" }, mode === "quick" ? (scores[i] >= 4.5 ? "feels steady" : "needs attention") : `${label(scores[i], F.scale)} (${scores[i] === null ? "–" : scores[i].toFixed(1)} of 5)`))));
  $("#result-lead").textContent = picks.length
    ? `${shared ? "This result suggests" : "Your answers suggest"} starting with ${picks.map((i) => FACTORS[i].name.toLowerCase()).join(picks.length > 2 ? ", " : " and ").replace(/, ([^,]*)$/, " and $1")}. The factors support each other, so work on one strengthens the rest.`
    : "Every factor feels steady. The practices below are for keeping them that way; or take the full check for a finer picture.";
  const show3 = picks.length ? picks : [0];
  $("#focus").replaceChildren(...show3.map((i) => practiceCard(FACTORS[i])));
  const link = `${CFG.siteUrl}/#${encodeResult(mode, scores)}`;
  $("#share-link").value = link;
  $("#shared-note").hidden = !shared;
  document.body.dataset.result = mode;
  document.body.dataset.focus = picks.map((i) => FACTORS[i].id).join(",");
  renderHistory();
  show("#result");
  $("#result h1").focus();
}

// ---------- wiring ----------

$("#go-quick").addEventListener("click", () => {
  renderQuick();
  show("#quick");
  track("check_start/quick");
});
$("#go-full").addEventListener("click", () => {
  renderFull();
  show("#full");
  track("check_start/full");
});
$("#quick-done").addEventListener("click", () => {
  const ticked = new Set([...document.querySelectorAll('input[name="steady"]:checked')].map((x) => Number(x.value)));
  const scores = scoreQuick(FACTORS.map((_, i) => ticked.has(i)));
  saveHistory("quick", scores);
  history.replaceState(null, "", location.pathname + "#" + encodeResult("quick", scores));
  showResult("quick", scores);
  track("check_done/quick");
});
$("#full-done").addEventListener("click", () => {
  const scores = scoreFull(FACTORS, answers);
  saveHistory("full", scores);
  history.replaceState(null, "", location.pathname + "#" + encodeResult("full", scores));
  showResult("full", scores);
  track("check_done/full");
});
$("#copy").addEventListener("click", (e) => {
  copyText($("#share-link").value, e.currentTarget, $("#share-link"));
  track("share_copy");
});
for (const b of document.querySelectorAll("[data-restart]")) {
  b.addEventListener("click", () => {
    history.replaceState(null, "", location.pathname);
    for (const k of Object.keys(answers)) delete answers[k];
    delete document.body.dataset.result;
    show("#start");
  });
}
function fromLocation() {
  const r = decodeResult(location.hash, FACTORS.length);
  if (r) {
    showResult(r.mode, r.scores, { shared: true });
    track("result_open");
  } else if (!$("#result").hidden) {
    // The address changed to something that isn't a result: don't leave the old one showing.
    delete document.body.dataset.result;
    show("#start");
  }
}
window.addEventListener("hashchange", fromLocation);

show("#start");
fromLocation();
document.body.dataset.ready = "1";
