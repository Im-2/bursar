// End-to-end test harness: drives the real app in headless Chrome over the DevTools protocol and plays
// the part of a browser wallet. The page gets a minimal EIP-1193 `window.ethereum` whose requests are
// forwarded to Node; Node signs with a THROWAWAY test key loaded from a file outside the repo
// (BURSAR_TEST_WALLET_FILE, a `cast wallet new --json` output). The key never enters the page or the app,
// and is never printed. Test-only tooling: nothing here ships in the web build.
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPublicClient, createWalletClient, fallback, http, numberToHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arbitrumSepolia } from "viem/chains";

const RPCS = ["https://sepolia-rollup.arbitrum.io/rpc", "https://arbitrum-sepolia-rpc.publicnode.com", "https://arbitrum-sepolia.drpc.org"];
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function loadTestAccount() {
  const file = process.env.BURSAR_TEST_WALLET_FILE;
  if (!file) throw new Error("Set BURSAR_TEST_WALLET_FILE to a throwaway wallet JSON (cast wallet new --json).");
  const raw = JSON.parse(readFileSync(file, "utf8"));
  const entry = Array.isArray(raw) ? raw[0] : raw;
  return privateKeyToAccount(entry.private_key);
}

export function clients(account) {
  const transport = fallback(RPCS.map((u) => http(u, { retryCount: 5, retryDelay: 400 })));
  return {
    publicClient: createPublicClient({ chain: arbitrumSepolia, transport }),
    walletClient: createWalletClient({ account, chain: arbitrumSepolia, transport }),
  };
}

const SHIM = `(() => {
  if (window.ethereum) return;
  const pending = new Map(); let n = 0; const listeners = {};
  window.__walletResolve = (id, result, error) => {
    const p = pending.get(id); if (!p) return; pending.delete(id);
    if (error) p.reject(Object.assign(new Error(error.message), { code: error.code })); else p.resolve(result);
  };
  window.__walletEmit = (ev, data) => (listeners[ev] || []).forEach((f) => { try { f(data); } catch {} });
  window.ethereum = {
    isBursarTestWallet: true,
    request: ({ method, params }) => new Promise((resolve, reject) => {
      const id = ++n; pending.set(id, { resolve, reject });
      window.__wallet(JSON.stringify({ id, method, params: params ?? [] }));
    }),
    on: (ev, f) => { (listeners[ev] ||= []).push(f); },
    removeListener: (ev, f) => { listeners[ev] = (listeners[ev] || []).filter((x) => x !== f); },
  };
})();`;

/** Launches Chrome with the wallet shim. `startChainId` lets tests begin on the wrong network. */
export async function launch({ account, startChainId = 1, width = 1440, height = 1000, log = () => {} }) {
  const { publicClient, walletClient } = clients(account);
  const chrome = process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe";
  const port = 9300 + Math.floor(Math.random() * 500);
  const proc = spawn(chrome, [
    "--headless=new", "--disable-gpu", "--hide-scrollbars", `--remote-debugging-port=${port}`,
    `--user-data-dir=${mkdtempSync(join(tmpdir(), "bursar-e2e-"))}`, "about:blank",
  ], { stdio: "ignore" });

  let target;
  for (let i = 0; i < 50 && !target; i++) {
    await sleep(200);
    target = await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json()).then((l) => l.find((t) => t.type === "page")).catch(() => null);
  }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener("open", r, { once: true }));
  let msgId = 0;
  const pending = new Map();
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++msgId;
      pending.set(id, (m) => (m.error ? reject(new Error(`${method}: ${m.error.message}`)) : resolve(m.result)));
      ws.send(JSON.stringify({ id, method, params }));
    });

  // ------------------------------------------------------------ wallet state + request handling
  const wallet = { connected: false, chainId: startChainId, sent: [] };
  const emit = (ev, data) => send("Runtime.evaluate", { expression: `window.__walletEmit(${JSON.stringify(ev)}, ${JSON.stringify(data)})` }).catch(() => {});

  async function handle(method, params) {
    switch (method) {
      case "eth_accounts":
        return wallet.connected ? [account.address] : [];
      case "eth_requestAccounts":
        wallet.connected = true;
        emit("accountsChanged", [account.address]);
        return [account.address];
      case "eth_chainId":
        return numberToHex(wallet.chainId);
      case "wallet_switchEthereumChain": {
        const id = Number(params[0].chainId);
        if (id !== arbitrumSepolia.id) throw Object.assign(new Error("Unrecognized chain"), { code: 4902 });
        wallet.chainId = id;
        emit("chainChanged", numberToHex(id));
        return null;
      }
      case "wallet_addEthereumChain":
        return null;
      case "eth_sendTransaction": {
        if (wallet.chainId !== arbitrumSepolia.id) throw Object.assign(new Error("Wrong network"), { code: 4901 });
        const t = params[0];
        const hash = await walletClient.sendTransaction({
          to: t.to,
          data: t.data,
          value: t.value ? BigInt(t.value) : undefined,
          gas: t.gas ? BigInt(t.gas) : undefined,
        });
        wallet.sent.push(hash);
        log(`  wallet signed ${hash}`);
        return hash;
      }
      default:
        return publicClient.request({ method, params });
    }
  }

  ws.addEventListener("message", async (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
      return;
    }
    if (msg.method === "Runtime.bindingCalled" && msg.params.name === "__wallet") {
      const { id, method, params } = JSON.parse(msg.params.payload);
      let result = null;
      let error = null;
      try {
        result = await handle(method, params);
      } catch (e) {
        error = { message: e.shortMessage ?? e.message, code: e.code ?? -32603 };
      }
      const expr = `window.__walletResolve(${id}, ${JSON.stringify(result, (_, v) => (typeof v === "bigint" ? numberToHex(v) : v))}, ${JSON.stringify(error)})`;
      send("Runtime.evaluate", { expression: expr }).catch(() => {});
    }
  });

  await send("Runtime.enable");
  await send("Runtime.addBinding", { name: "__wallet" });
  await send("Page.enable");
  await send("Page.addScriptToEvaluateOnNewDocument", { source: SHIM });
  await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: width < 600 });

  // ------------------------------------------------------------ page helpers
  const evaluate = async (expression) => {
    const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? "evaluate failed");
    return r.result.value;
  };

  const page = {
    wallet,
    evaluate,
    async goto(url) {
      await send("Page.navigate", { url });
      await sleep(800);
    },
    async waitFor(expression, { timeout = 60000, label = expression } = {}) {
      const end = Date.now() + timeout;
      while (Date.now() < end) {
        try {
          if (await evaluate(expression)) return;
        } catch {}
        await sleep(400);
      }
      throw new Error(`timed out waiting for: ${label}`);
    },
    async click(selector) {
      const ok = await evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; el.scrollIntoView({block:'center'}); el.click(); return true; })()`);
      if (!ok) throw new Error(`no element ${selector}`);
    },
    /** Sets a React-controlled input/select value. */
    async fill(selector, value) {
      const ok = await evaluate(`(() => {
        const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false;
        const proto = el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(value)});
        el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
        return true; })()`);
      if (!ok) throw new Error(`no input ${selector}`);
    },
    /** Waits for the tx status inside `scope` to reach confirmed/failed; returns {status, errorName, hash}. */
    async txResult(scope, { timeout = 90000, expect } = {}) {
      const end = Date.now() + timeout;
      while (Date.now() < end) {
        const r = await evaluate(`(() => {
          const root = document.querySelector(${JSON.stringify(scope)}); if (!root) return null;
          const s = [...root.querySelectorAll('[data-testid=tx-status]')].pop(); if (!s) return null;
          return { status: s.dataset.status, errorName: s.querySelector('[data-testid=tx-error-name]')?.textContent ?? null,
                   hash: s.querySelector('[data-testid=tx-link]')?.getAttribute('href')?.split('/tx/')[1] ?? null,
                   text: s.textContent };
        })()`);
        if (r && (r.status === "confirmed" || r.status === "failed")) {
          if (expect && r.status !== expect) throw new Error(`expected ${expect} in ${scope}, got ${r.status}: ${r.text}`);
          return r;
        }
        await sleep(500);
      }
      throw new Error(`no tx result in ${scope}`);
    },
    async screenshot(path, { fullPage = true } = {}) {
      let h = height;
      if (fullPage) h = await evaluate("document.documentElement.scrollHeight");
      await send("Emulation.setDeviceMetricsOverride", { width, height: h, deviceScaleFactor: width < 600 ? 2 : 1, mobile: width < 600 });
      await sleep(600);
      const shot = await send("Page.captureScreenshot", { format: "png" });
      writeFileSync(path, Buffer.from(shot.data, "base64"));
      await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: width < 600 });
      return path;
    },
    async setViewport(w, h) {
      width = w;
      height = h;
      await send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: w < 600 });
    },
    async close() {
      ws.close();
      proc.kill();
    },
  };
  return page;
}
