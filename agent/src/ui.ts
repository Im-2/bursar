// Console output helpers for a readable, screen-recordable story.
import { formatUnits, stringToHex, type Address, type Hex } from "viem";
import type { TokenInfo } from "./config.js";

const color = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code: number) => (s: string) => (color ? `\x1b[${code}m${s}\x1b[0m` : s);
export const bold = paint(1);
export const dim = paint(2);
export const green = paint(32);
export const red = paint(31);
export const yellow = paint(33);
export const cyan = paint(36);

const EXPLORER = "https://sepolia.arbiscan.io";
export const txLink = (hash: Hex) => `${EXPLORER}/tx/${hash}`;
export const addrLink = (a: Address) => `${EXPLORER}/address/${a}`;

let token: TokenInfo = { symbol: "USDG", decimals: 6 };
export function setToken(t: TokenInfo) {
  token = t;
}

/** "25 mUSDG (25000000 base units)" */
export function amt(raw: bigint): string {
  return `${bold(`${formatUnits(raw, token.decimals)} ${token.symbol}`)} ${dim(`(${raw} base units)`)}`;
}

/** Whole-token amount to base units, e.g. units(25) = 25_000_000n for 6 decimals. */
export function units(whole: number): bigint {
  return BigInt(whole) * 10n ** BigInt(token.decimals);
}

/** Short ASCII reason code as the bytes32 the vault expects. */
export const reason = (code: string): Hex => stringToHex(code, { size: 32 });

export function banner(title: string) {
  const line = "═".repeat(Math.max(title.length + 4, 60));
  console.log(`\n${cyan(line)}\n  ${bold(title)}\n${cyan(line)}`);
}

export function step(n: number | string, title: string) {
  console.log(`\n${cyan(`── Step ${n}`)} ${bold(title)}`);
}

export function kv(label: string, value: string) {
  console.log(`   ${dim(label.padEnd(24))} ${value}`);
}

export const info = (msg: string) => console.log(`   ${msg}`);
export const ok = (msg: string) => console.log(`   ${green("✔")} ${msg}`);
export const blocked = (msg: string) => console.log(`   ${red("✖")} ${msg}`);
export const queued = (msg: string) => console.log(`   ${yellow("⏸")} ${msg}`);

export function tx(hash: Hex) {
  kv("tx hash", hash);
  kv("arbiscan", txLink(hash));
}

export function fatal(msg: string): never {
  console.error(`\n${red("Stopped:")} ${msg}\n`);
  process.exit(1);
}
