// Small helpers shared by the stamp and check pages. Text from a proof or link only ever reaches the
// page through textContent, never as HTML.

const cfgEl = document.getElementById("site-config");
export const CFG = cfgEl ? JSON.parse(cfgEl.textContent) : { root: "./", siteUrl: location.origin };

export const $ = (sel, root = document) => root.querySelector(sel);

/** h("p", { class: "note" }, "text", child) builds an element; strings become text nodes. */
export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === false || v === null || v === undefined) continue;
    if (k === "class") el.className = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (v === true) el.setAttribute(k, "");
    else el.setAttribute(k, String(v));
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function svg(tag, attrs, ...children) {
  const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [k, v] of Object.entries(attrs || {})) el.setAttribute(k, String(v));
  for (const c of children.flat()) if (c) el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return el;
}

/** Counts an event with GoatCounter when the site owner has switched analytics on. Never sends file data. */
export function track(name) {
  try {
    if (window.goatcounter && window.goatcounter.count) window.goatcounter.count({ path: `event/${name}`, title: name, event: true });
  } catch {
    /* analytics must never break stamping */
  }
}

const dateTime = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });
const dateOnly = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });
const timeOnly = new Intl.DateTimeFormat(undefined, { timeStyle: "medium" });
export const fmtDateTime = (ms) => dateTime.format(new Date(ms));
const zoned = new Intl.DateTimeFormat(undefined, { year: "numeric", month: "long", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" });
/** "28 May 2015, 11:41 EDT": a date and time with its time zone, for timestamps. */
export const fmtWhen = (ms) => zoned.format(new Date(ms));
export const fmtDate = (ms) => dateOnly.format(new Date(ms));
export const fmtTime = (ms) => timeOnly.format(new Date(ms));
export const fmtInt = (n) => n.toLocaleString();

/** m:ss or h:mm:ss for a player clock. */
export function clock(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return hh ? `${hh}:${String(mm).padStart(2, "0")}:${ss}` : `${mm}:${ss}`;
}

export function download(name, text) {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const a = h("a", { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Copy text and say so on the button for a moment. Falls back to selecting a field. */
export async function copyText(text, button, field) {
  let ok = false;
  try {
    await navigator.clipboard.writeText(text);
    ok = true;
  } catch {
    if (field) {
      field.focus();
      field.select();
      try {
        ok = document.execCommand("copy");
      } catch {
        ok = false;
      }
    }
  }
  if (button) {
    const was = button.dataset.label || button.textContent;
    button.dataset.label = was;
    button.textContent = ok ? "Copied" : "Press Ctrl+C to copy";
    setTimeout(() => {
      button.textContent = was;
    }, 1800);
  }
  return ok;
}

/** "ab12 cd34 ef56" from the start of a hex fingerprint. */
export const shortPrint = (hex) => hex.slice(0, 12).replace(/(.{4})(?=.)/g, "$1 ");

export function fmtBytes(n) {
  if (n < 1024) return `${n} bytes`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
}

/** Save bytes as a file on the visitor's device. */
export function downloadBytes(name, bytes, type = "application/octet-stream") {
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const a = h("a", { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
