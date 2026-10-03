# Bursar dashboard (`web/`)

Vite + React + TypeScript + [viem](https://viem.sh), with plain custom CSS. It's a **read-only** view of the live BursarVault on Arbitrum Sepolia. Every number is read from the chain; there is no wallet, signer or private key anywhere in this app.

| Route | Page |
|---|---|
| `/dashboard` | Stage A dashboard: vault, balances, agents, tasks, approval queue, escrows, live activity |
| `/` | Reserved for the landing page; currently redirects to `/dashboard` |

![Dashboard, desktop](../docs/screenshots/dashboard-desktop.png)

## Run

```bash
cd web
npm install
npm run dev        # http://localhost:5173/dashboard
npm run build      # typecheck + production build into dist/
npm run preview    # serve the production build
```

On Windows PowerShell, use `npm.cmd` if `npm` is blocked by the script execution policy.

## Configuration

Copy `.env.example` to `.env.local`. Only `VITE_`-prefixed variables reach the browser, and everything in them is bundled into public JavaScript, so **never put a key or secret here**. This app doesn't need one.

| Variable | Default | Purpose |
|---|---|---|
| `VITE_RPC_URL` | `https://sepolia-rollup.arbitrum.io/rpc` | Primary JSON-RPC endpoint |
| `VITE_RPC_FALLBACK_URL` | `https://arbitrum-sepolia-rpc.publicnode.com` | Used only when a primary request fails; set to empty to disable |
| `VITE_POLL_MS` | `6000` | Refresh interval |

The fallback exists because the official public endpoint occasionally returns a malformed CORS header (`Access-Control-Allow-Origin: *,*`) to browsers. Those requests fail in the browser even though they work from `curl`. With the fallback, a failed request is retried on the second endpoint, so the page keeps updating. The browser console still logs the rejected responses.

## Where the data comes from

- **Addresses:** `../deployments/arbitrum-sepolia.json`, imported at build time. Vite is allowed to read only that folder outside `web/`.
- **ABIs:** `src/abi.ts`, generated from Foundry's compiled artifacts. After changing the contracts, run `forge build` in the repo root, then `npm run abi`.
- **Live state:** `src/lib/useVault.ts` polls every `VITE_POLL_MS`:
  - **State reads** (owner, paused, balances, policies, tasks, requests, escrows) are batched into multicall3 requests.
  - **Vault event logs** start at the vault's deploy block, then only new blocks are fetched. They drive the activity feed and let the dashboard discover agents, allowlisted recipients and tasks; the current state of each is then read on-chain.
  - **Block timestamps** for the feed are cached.
- **Countdowns and the "expired" flags** use the latest block timestamp, ticking locally between refreshes.

Amounts are shown in human units (6 decimals) with thousands separators. Hover any amount to see its raw base-unit value. If the RPC fails, the page keeps the last good data, shows an error banner, and turns "last updated" amber.

## Design system

`src/styles/design-system.css` (tokens and base styles) and `src/components/ds.tsx` (Card, Badge, Button, SectionBar, Stat, KV, Table) are shared, so the landing page can reuse them.

- **Colors:** black `#000`, page `#F2F2F2`, card `#FFF`, lime `#D4FF00`, amber `#FFC148`, green `#00D46E`, blue `#0352A1`, gray `#465063`.
- **Font:** JetBrains Mono from Google Fonts, with tabular numbers.
- **Shapes:** square corners, 4px black borders, and no shadows or gradients.
- **Tables:** collapse into labelled blocks below 760px.
- **Accessibility:** keyboard focus is always visible as a 3px blue outline.

## Screenshots

`docs/screenshots/` holds full-page captures at desktop (1440px) and phone (390px, 2×) widths, taken from the running app against the live vault. To regenerate them while `npm run dev` is running:

```bash
node web/scripts/screenshot.mjs http://localhost:5173/dashboard docs/screenshots/dashboard-desktop.png 1440 1 false
node web/scripts/screenshot.mjs http://localhost:5173/dashboard docs/screenshots/dashboard-phone.png 390 2 true
```

The script drives a local Chrome through the DevTools protocol, so it emulates a true phone viewport. Plain `--headless --window-size` can't go below about 500px on Windows. Set `CHROME_PATH` if Chrome isn't in its default location.
