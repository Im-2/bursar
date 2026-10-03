import { formatUnits, hexToBytes, type Hex } from "viem";

/** Human amount with thousands separators, e.g. 9860000000n -> "9,860". Never rounds away precision. */
export function formatAmount(raw: bigint, decimals: number): string {
  const [int, frac] = formatUnits(raw, decimals).split(".");
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return frac ? `${grouped}.${frac}` : grouped;
}

export const shortAddr = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
export const shortHash = (h: string) => `${h.slice(0, 6)}…${h.slice(-4)}`;

/** bytes32 reason/role code to text ("API_FEE"); falls back to short hex if not printable ASCII. */
export function decodeBytes32(value: Hex): string {
  const bytes = hexToBytes(value);
  let end = bytes.length;
  while (end > 0 && bytes[end - 1] === 0) end--;
  if (end === 0) return "—";
  const slice = bytes.slice(0, end);
  if (slice.every((b) => b >= 0x20 && b <= 0x7e)) return String.fromCharCode(...slice);
  return shortHash(value);
}

export function formatDateTime(unixSeconds: bigint | number): string {
  const d = new Date(Number(unixSeconds) * 1000);
  return d.toISOString().replace("T", " ").slice(0, 16) + " UTC";
}

/** "2d 21h 14m", "14m 03s", or "expired". */
export function formatCountdown(seconds: number): string {
  if (seconds <= 0) return "expired";
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
  return `${m}m ${String(s).padStart(2, "0")}s`;
}

export function formatAgo(seconds: number): string {
  if (seconds < 60) return `${Math.max(0, Math.floor(seconds))}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}
