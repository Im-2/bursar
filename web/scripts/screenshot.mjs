// Full-page screenshots via the Chrome DevTools Protocol (no extra deps; Node >= 22 has WebSocket).
// Usage: node scripts/screenshot.mjs <url> <out.png> <width> [deviceScaleFactor] [mobile]
// Needs a local Chrome/Edge; set CHROME_PATH if it isn't in the default Windows location.
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const [url, out, width = "1440", dpr = "1", mobile = "false"] = process.argv.slice(2);
const chrome = process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const port = 9300 + Math.floor(Math.random() * 500);
const proc = spawn(chrome, [
  "--headless=new", "--disable-gpu", "--hide-scrollbars", `--remote-debugging-port=${port}`,
  `--user-data-dir=${mkdtempSync(join(tmpdir(), "bursar-shot-"))}`, "about:blank",
], { stdio: "ignore" });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let target;
for (let i = 0; i < 50 && !target; i++) {
  await sleep(200);
  target = await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json()).then((l) => l.find((t) => t.type === "page")).catch(() => null);
}
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r, { once: true }));
let id = 0;
const pending = new Map();
ws.addEventListener("message", (m) => {
  const msg = JSON.parse(m.data);
  if (msg.id && pending.has(msg.id)) pending.get(msg.id)(msg);
});
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const n = ++id;
    pending.set(n, (msg) => (msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result)));
    ws.send(JSON.stringify({ id: n, method, params }));
  });

const w = Number(width);
const metrics = { width: w, height: 900, deviceScaleFactor: Number(dpr), mobile: mobile === "true" };
await send("Emulation.setDeviceMetricsOverride", metrics);
await send("Page.enable");
await send("Page.navigate", { url });
// Wait until the dashboard has rendered live data (the "updated … block" line), max 30s.
for (let i = 0; i < 60; i++) {
  await sleep(500);
  const r = await send("Runtime.evaluate", { expression: "document.querySelector('.dash-updated')?.textContent || ''", returnByValue: true });
  if (/block \d+/.test(r.result.value)) break;
}
await sleep(1500);
const { result } = await send("Runtime.evaluate", {
  expression: "JSON.stringify({h: document.documentElement.scrollHeight, overflow: document.documentElement.scrollWidth > innerWidth, vw: innerWidth})",
  returnByValue: true,
});
const info = JSON.parse(result.value);
await send("Emulation.setDeviceMetricsOverride", { ...metrics, height: info.h });
await sleep(500);
const shot = await send("Page.captureScreenshot", { format: "png" });
writeFileSync(out, Buffer.from(shot.data, "base64"));
console.log(`${out}: viewport ${info.vw}px, page ${info.h}px tall, horizontal overflow: ${info.overflow}`);
ws.close();
proc.kill();
process.exit(0);
