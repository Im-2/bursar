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

// Test wallet(s) in the page. Each announced wallet is a separate EIP-1193 provider (EIP-6963), all
// bridged to the same Node signer; the first is also window.ethereum for legacy injected discovery.
const shim = (wallets) => `(() => {
  if (window.__bursarTestWallet) return;
  window.__bursarTestWallet = true;
  const pending = new Map(); let n = 0; const listeners = {}; // listeners[rdns][event]
  window.__walletResolve = (id, result, error) => {
    const p = pending.get(id); if (!p) return; pending.delete(id);
    if (error) p.reject(Object.assign(new Error(error.message), { code: error.code })); else p.resolve(result);
  };
  window.__walletEmit = (rdns, ev, data) => ((listeners[rdns] || {})[ev] || []).forEach((f) => { try { f(data); } catch {} });
  const make = (rdns) => ({
    isBursarTestWallet: true,
    request: ({ method, params }) => new Promise((resolve, reject) => {
      const id = ++n; pending.set(id, { resolve, reject });
      window.__wallet(JSON.stringify({ id, method, params: params ?? [], rdns }));
    }),
    on: (ev, f) => { ((listeners[rdns] ||= {})[ev] ||= []).push(f); },
    removeListener: (ev, f) => { const l = (listeners[rdns] ||= {}); l[ev] = (l[ev] || []).filter((x) => x !== f); },
  });
  const wallets = ${JSON.stringify(wallets)};
  const providers = wallets.map((w) => ({ info: w, provider: make(w.rdns) }));
  if (providers[0]) window.ethereum = providers[0].provider;
  const announce = () => providers.forEach((p) =>
    window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail: Object.freeze({ info: p.info, provider: p.provider }) })));
  window.addEventListener("eip6963:requestProvider", announce);
  announce();
})();`;

const icon = (letter, bg) =>
  "data:image/svg+xml," + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" fill="${bg}"/><text x="16" y="22" font-family="monospace" font-weight="700" font-size="16" fill="#000" text-anchor="middle">${letter}</text></svg>`);
export const TEST_WALLETS = [
  { uuid: "8f3c1d2e-0000-4000-8000-000000000001", name: "Bursar Test Wallet", icon: icon("T", "#D4FF00"), rdns: "xyz.bursar.testwallet" },
  { uuid: "8f3c1d2e-0000-4000-8000-000000000002", name: "Second Test Wallet", icon: icon("2", "#FFC148"), rdns: "xyz.bursar.testwallet2" },
];

/** Launches Chrome with the wallet shim. `startChainId` lets tests begin on the wrong network. */
export async function launch({ account, startChainId = 1, width = 1440, height = 1000, log = () => {}, wallets = 1 }) {
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
  const wallet = { connected: false, chainId: startChainId, sent: [], rejectNext: false };
  // Events go only to the provider (wallet) that made the request, like separate real wallets.
  const emit = (rdns, ev, data) =>
    send("Runtime.evaluate", { expression: `window.__walletEmit(${JSON.stringify(rdns)}, ${JSON.stringify(ev)}, ${JSON.stringify(data)})` }).catch(() => {});

  async function handle(method, params, rdns) {
    if (wallet.rejectNext && ["eth_requestAccounts", "wallet_requestPermissions"].includes(method)) {
      wallet.rejectNext = false;
      throw Object.assign(new Error("User rejected the request."), { code: 4001 });
    }
    switch (method) {
      case "eth_accounts":
        return wallet.connected ? [account.address] : [];
      case "eth_requestAccounts":
        wallet.connected = true;
        emit(rdns, "accountsChanged", [account.address]);
        return [account.address];
      case "eth_chainId":
        return numberToHex(wallet.chainId);
      case "wallet_switchEthereumChain": {
        const id = Number(params[0].chainId);
        if (id !== arbitrumSepolia.id) throw Object.assign(new Error("Unrecognized chain"), { code: 4902 });
        wallet.chainId = id;
        emit(rdns, "chainChanged", numberToHex(id));
        return null;
      }
      case "wallet_addEthereumChain":
        return null;
      case "wallet_requestPermissions":
      case "wallet_getPermissions":
        return [{ parentCapability: "eth_accounts" }];
      case "wallet_revokePermissions":
        wallet.connected = false;
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
      const { id, method, params, rdns } = JSON.parse(msg.params.payload);
      let result = null;
      let error = null;
      try {
        result = await handle(method, params, rdns);
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
  await send("Page.addScriptToEvaluateOnNewDocument", { source: shim(TEST_WALLETS.slice(0, wallets)) });
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
    /** Runs `action` (usually a click) and waits until the wallet has signed `count` new transactions and
     *  each one is mined successfully. Returns the tx hashes. */
    async signed(label, action, { count = 1, timeout = 120000 } = {}) {
      const before = wallet.sent.length;
      const failedBefore = await evaluate("document.querySelectorAll('[data-testid=tx-status][data-status=failed]').length");
      await action();
      const end = Date.now() + timeout;
      while (wallet.sent.length < before + count) {
        const failed = await evaluate("[...document.querySelectorAll('[data-testid=tx-status][data-status=failed]')].map((s) => s.textContent)");
        if (failed.length > failedBefore) throw new Error(`${label}: UI reported failure: ${failed[failed.length - 1]}`);
        if (Date.now() > end) throw new Error(`${label}: wallet only signed ${wallet.sent.length - before}/${count}`);
        await sleep(300);
      }
      const hashes = wallet.sent.slice(before, before + count);
      for (const hash of hashes) {
        const r = await publicClient.waitForTransactionReceipt({ hash });
        if (r.status !== "success") throw new Error(`${label}: ${hash} reverted`);
      }
      log(`  ✓ ${label}  ${hashes.join(", ")}`);
      await sleep(2500); // let the page refresh from the chain
      return hashes;
    },
    /** Opens the connect modal and picks the test wallet (EIP-6963 entry). */
    async connect(rdns = TEST_WALLETS[0].rdns) {
      await this.click('[data-testid="connect-wallet"]');
      await this.waitFor(`!!document.querySelector('[data-testid="wallet-option-${rdns}"]')`, { label: "test wallet in modal" });
      await this.click(`[data-testid="wallet-option-${rdns}"]`);
      await this.waitFor(`!!document.querySelector('[data-testid=wallet-account]')`, { label: "connected on Arbitrum Sepolia" });
    },
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
    /** Clicks an element, waiting (up to 60s) for it to exist and be enabled, like a person would. */
    async click(selector) {
      const end = Date.now() + 60000;
      for (;;) {
        const r = await evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return 'missing'; if (el.disabled) return 'disabled'; el.scrollIntoView({block:'center'}); el.click(); return 'ok'; })()`);
        if (r === "ok") return;
        if (Date.now() > end) throw new Error(`cannot click ${selector}: ${r}`);
        await sleep(300);
      }
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
