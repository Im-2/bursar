# Bursar demo: 2.5-minute recording script

Everything shown is live: the site at **https://trybursar.vercel.app** and the real agent run in [`docs/ai-agent-run.txt`](ai-agent-run.txt). No wallet connection or transaction is needed during the recording.

## Before you hit record

Open these tabs, in this order:

1. **Landing:** https://trybursar.vercel.app/
2. **Dashboard:** https://trybursar.vercel.app/dashboard (wait until the top bar shows "Live · Updated … · block …")
3. **Blocked tx on Arbiscan:** https://sepolia.arbiscan.io/tx/0x1d286b573a9f0c5ada4c0d4378bdfbaf4a92f42cfbccd50142b6b25f6b9e987b (scroll the page so **Status: Success** is visible; the **Logs** tab has `PaymentBlocked`)
4. **Agent transcript on GitHub:** https://github.com/Im-2/bursar/blob/master/docs/ai-agent-run.txt
5. **Playground:** https://trybursar.vercel.app/try

Notes:
- **Time-dependent numbers:** "spent today", "3 blocked attempts today" and the chart reset at 00:00 UTC. If you record on a later day, read out the activity feed (it keeps everything) instead of the "today" numbers.
- **Escrow #2:** it can be refunded by anyone after 2026-10-04 20:00 UTC; until then it shows as locked.
- **Browser setup:** zoom to 110–125% so text reads well on video, and hide bookmarks.

## Script (150 seconds)

| Time | Screen and clicks | Voice-over |
|---|---|---|
| **0:00–0:12** | Tab 1, landing hero. Let the illustration play: coin travels to the vendor, the other bounces off the vault under "BLOCKED". | "AI agents need to spend money: on data, APIs, other agents, people. Today you either hand them your wallet or approve every payment by hand. Bursar is the middle ground: give your AI agent a budget, not your wallet." |
| **0:12–0:30** | Click **How it works** in the nav. It scrolls to the three steps. Point at each card. | "The owner funds a vault and stays the owner. They set the policy: a per-payment cap, a daily cap, an approval threshold, allowed recipients, and a task budget with an expiry. Then the agent works on its own, and the smart contract enforces every rule." |
| **0:30–0:42** | Click **Open dashboard** (top right). Tab 2 content loads. Point at the vault hero: **Live**, the balance, "135 / 500 mUSDG", "3 blocked attempts today". | "This is the live demo vault on Arbitrum Sepolia, read straight from the chain. No backend and no keys in the browser." |
| **0:42–1:05** | Click **Activity** in the sidebar. Read the top four rows, newest first. | "We gave Claude Code a purchasing job through our MCP server. Here's what the contract did. It bought a market-prices feed for 20, paid. It hired a research sub-agent with a 30 escrow, locked until the owner releases it. It tried to buy a premium dataset for 150. That's over its 100 cap, so it was blocked: no money moved, and the attempt is logged on-chain with its reason. Then a 60 bounty to a human who isn't on the allowlist: queued for the owner." |
| **1:05–1:15** | Tab 3, Arbiscan. Point at **Status: Success**, then click **Logs** and point at `PaymentBlocked`. | "A blocked payment is a successful transaction that records the refusal, so even failed attempts are part of the audit trail." |
| **1:15–1:45** | Tab 4, GitHub transcript. Point at the header ("driven by Claude Code via the Bursar MCP server, on a Claude subscription… No paid API"). Scroll to tool call 5 and the line `[agent] Blocked as expected. I won't retry or split it.` Then scroll to the final report table. | "The agent was Claude Code, running on a normal subscription, with only four tools: check policy, list vendors, pay, create escrow. It never sees the private key; the MCP server holds it. When it hit the cap, it didn't retry or split the payment. It explained the block in plain words and reported every transaction hash. The same limits apply to any agent holding the key." |
| **1:45–2:00** | Tab 2, dashboard. Click **Approvals**: request **#3**, 60 mUSDG, waiting. Then click **Settings** and show the owner console heading. | "Big or unknown payments wait here for the owner. The owner can approve, reject, release escrows, change policies or pause the whole vault at any time." |
| **2:00–2:15** | Tab 5, playground. Scroll slowly past the steps and the scenario cards. | "Anyone can try it: connect a wallet, create your own vault from the factory, and run the paid, queued and blocked scenarios as real testnet transactions." |
| **2:15–2:30** | Tab 1, landing. Click **FAQ**, then the **Safety** tab, and open "Is it audited?". End on the hero. | "It's open source with 203 Foundry tests, including fuzz and invariant tests, and 100% coverage. It's honest about its limits: testnet, a mock stablecoin, not audited yet. Bursar: give your AI agent a budget, not your wallet." |

## Facts used in the voice-over (all checkable)

| Claim | Source |
|---|---|
| Paid 20 / escrow 30 / blocked 150 / queued 60 | Tx `0x4c06…4d8c`, `0x4dd5…1c61`, `0x1d28…987b`, `0xae7b…d6be`, verified on-chain in `docs/ai-agent-run.txt` |
| Per-payment cap 100, threshold 50, daily cap 500 | Demo agent policy, `deployments/arbitrum-sepolia.json` |
| "Didn't retry or split it" | Transcript: one 150 call, then the agent's message "Blocked as expected. I won't retry or split it." |
| Claude Code on a subscription, no paid API | Transcript header (`apiKeySource = 'none'`, Claude Pro login) |
| 203 tests, 100% coverage | `forge test` and `forge coverage`, README "Tests" |
| Testnet, mock token, not audited | README "Security and assumptions"; FAQ |

Don't say USDG payments were tested (they weren't), or that swaps, ERC-4337 or multisig defaults exist (roadmap only).
