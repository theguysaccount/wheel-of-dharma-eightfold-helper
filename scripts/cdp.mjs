// A small Chrome DevTools Protocol client for end-to-end tests and screenshots. No dependencies:
// Node 22+ has WebSocket built in. Input sent through the protocol arrives in the page as trusted
// events, the same as a person's keyboard, which is what the recorder needs to see.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const CANDIDATES = [
  process.env.CHROME,
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
].filter(Boolean);

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function launch() {
  const bin = CANDIDATES.find((c) => fs.existsSync(c));
  if (!bin) throw new Error("Chrome not found; set CHROME");
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "e2e-chrome-"));
  const args = ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run", "--no-default-browser-check",
    "--autoplay-policy=no-user-gesture-required",
    "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"];
  if (process.env.CI || process.getuid?.() === 0) args.unshift("--no-sandbox");
  const proc = spawn(bin, args, { stdio: ["ignore", "ignore", "pipe"] });
  const wsUrl = await new Promise((resolve, reject) => {
    let buf = "";
    const timer = setTimeout(() => reject(new Error("Chrome didn't start: " + buf.slice(-400))), 30000);
    proc.stderr.on("data", (d) => {
      buf += d;
      const m = buf.match(/DevTools listening on (ws:\/\/\S+)/);
      if (m) {
        clearTimeout(timer);
        resolve(m[1]);
      }
    });
    proc.on("exit", () => reject(new Error("Chrome exited: " + buf.slice(-400))));
  });
  const ws = new WebSocket(wsUrl);
  await new Promise((r, j) => {
    ws.addEventListener("open", r, { once: true });
    ws.addEventListener("error", j, { once: true });
  });
  let seq = 0;
  const waiting = new Map();
  const listeners = new Set();
  ws.addEventListener("message", (e) => {
    const m = JSON.parse(e.data);
    if (m.id && waiting.has(m.id)) {
      const { resolve, reject, method } = waiting.get(m.id);
      waiting.delete(m.id);
      if (m.error) reject(new Error(`${method}: ${m.error.message}`));
      else resolve(m.result);
    } else for (const l of listeners) l(m);
  });
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = ++seq;
    waiting.set(id, { resolve, reject, method });
    ws.send(JSON.stringify({ id, method, params, sessionId }));
  });

  async function newPage() {
    const { targetId } = await send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
    const page = new Page(send, sessionId, listeners);
    await page.init();
    return page;
  }

  async function close() {
    try {
      ws.close();
    } catch { /* already closed */ }
    const exited = new Promise((r) => proc.once("exit", r));
    proc.kill();
    await Promise.race([exited, sleep(5000)]);
    fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }

  return { send, newPage, close };
}

const MAC = process.platform === "darwin";

export class Page {
  constructor(send, sessionId, listeners) {
    this.raw = send;
    this.sessionId = sessionId;
    this.errors = [];
    this.requests = [];
    this.loaded = null;
    listeners.add((m) => {
      if (m.sessionId !== sessionId) return;
      if (m.method === "Runtime.exceptionThrown") {
        const d = m.params.exceptionDetails;
        this.errors.push(`exception: ${d.exception?.description || d.text}`);
      } else if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") {
        this.errors.push(`console.error: ${m.params.args.map((a) => a.value ?? a.description).join(" ")}`);
      } else if (m.method === "Log.entryAdded" && m.params.entry.level === "error") {
        this.errors.push(`log: ${m.params.entry.text} ${m.params.entry.url || ""}`.trim());
      } else if (m.method === "Network.requestWillBeSent") {
        this.requests.push(m.params.request.url);
      } else if ((m.method === "Page.loadEventFired" || m.method === "Page.navigatedWithinDocument") && this.loaded) {
        this.loaded();
        this.loaded = null;
      }
    });
  }

  send(method, params = {}) {
    return this.raw(method, params, this.sessionId);
  }

  async init() {
    for (const d of ["Page", "Runtime", "Log", "Network"]) await this.send(`${d}.enable`);
  }

  async goto(url, { wait = "body[data-ready]" } = {}) {
    const loaded = new Promise((r) => { this.loaded = r; });
    await this.send("Page.navigate", { url });
    await Promise.race([loaded, sleep(30000)]);
    if (wait) await this.waitFor(`document.querySelector(${JSON.stringify(wait)})`, `${wait} on ${url}`);
  }

  async eval(expression) {
    const r = await this.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true, userGesture: true });
    if (r.exceptionDetails) throw new Error(`in page: ${r.exceptionDetails.exception?.description || r.exceptionDetails.text}`);
    return r.result.value;
  }

  async waitFor(expression, what = expression, ms = 20000) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      const v = await this.eval(`(() => { try { return ${expression}; } catch { return null; } })()`);
      if (v) return v;
      await sleep(50);
    }
    throw new Error(`timed out waiting for ${what}`);
  }

  async click(selector) {
    const ok = await this.eval(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; el.click(); return true; })()`);
    if (!ok) throw new Error(`no element ${selector}`);
  }

  async focus(selector) {
    await this.eval(`document.querySelector(${JSON.stringify(selector)}).focus()`);
  }

  async key(key, { code = key, keyCode = 0, text, commands, modifiers = 0 } = {}) {
    const down = { type: text ? "keyDown" : "rawKeyDown", key, code, windowsVirtualKeyCode: keyCode, modifiers };
    if (text) Object.assign(down, { text, unmodifiedText: text });
    if (commands) down.commands = commands;
    await this.send("Input.dispatchKeyEvent", down);
    await this.send("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode: keyCode, modifiers });
  }

  /** Type one character at a time as real key presses, with the given gap(s) in ms. */
  async type(text, gap = 40) {
    let i = 0;
    for (const ch of text) {
      if (ch === "\n") await this.key("Enter", { code: "Enter", keyCode: 13, text: "\r" });
      else await this.key(ch, { text: ch });
      const ms = typeof gap === "function" ? gap(i++) : gap;
      if (ms) await sleep(ms);
    }
  }

  async backspace(n = 1, gap = 40) {
    for (let i = 0; i < n; i++) {
      await this.key("Backspace", { code: "Backspace", keyCode: 8 });
      if (gap) await sleep(gap);
    }
  }

  async command(name, key, keyCode) {
    await this.key(key, { code: `Key${key.toUpperCase()}`, keyCode, commands: [name], modifiers: MAC ? 4 : 2 });
  }

  /** Put text on the clipboard and paste it with the browser's own paste command. */
  async paste(text) {
    await this.raw("Browser.grantPermissions", { permissions: ["clipboardReadWrite", "clipboardSanitizedWrite"] });
    const r = await this.eval(`navigator.clipboard.writeText(${JSON.stringify(text)}).then(() => "ok", (e) => "failed: " + e.message)`);
    if (r !== "ok") throw new Error(`clipboard ${r}`);
    await this.command("paste", "v", 86);
  }

  async insertText(text) {
    await this.send("Input.insertText", { text });
  }

  async viewport(width, height, mobile = false) {
    await this.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile });
  }

  async setFile(selector, file) {
    const { root } = await this.send("DOM.getDocument", { depth: 0 });
    const { nodeId } = await this.send("DOM.querySelector", { nodeId: root.nodeId, selector });
    await this.send("DOM.setFileInputFiles", { nodeId, files: [file] });
  }

  async screenshot(file, { fullPage = false } = {}) {
    const params = { format: "png" };
    if (fullPage) {
      const { cssContentSize } = await this.send("Page.getLayoutMetrics");
      params.captureBeyondViewport = true;
      params.clip = { x: 0, y: 0, width: cssContentSize.width, height: Math.min(cssContentSize.height, 6000), scale: 1 };
    }
    const { data } = await this.send("Page.captureScreenshot", params);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, Buffer.from(data, "base64"));
  }
}

/** Serve a folder over HTTP on 127.0.0.1 for local test runs. Returns { url, close }. */
export async function serve(dir) {
  const http = await import("node:http");
  const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
    ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".txt": "text/plain; charset=utf-8",
    ".xml": "application/xml", ".mp3": "audio/mpeg", ".wav": "audio/wav", ".ots": "application/octet-stream" };
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (p.endsWith("/")) p += "index.html";
    const file = path.join(dir, p);
    if (!file.startsWith(path.resolve(dir)) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      const nf = path.join(dir, "404.html");
      res.writeHead(404, { "content-type": "text/html; charset=utf-8" });
      res.end(fs.existsSync(nf) ? fs.readFileSync(nf) : "not found");
      return;
    }
    res.writeHead(200, { "content-type": types[path.extname(file)] || "application/octet-stream" });
    res.end(fs.readFileSync(file));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return { url: `http://127.0.0.1:${server.address().port}/`, close: () => new Promise((r) => server.close(r)) };
}
