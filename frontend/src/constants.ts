// Real devnet addresses -- wallet A/B/C match scripts/eligibility-test's
// prepared keypairs exactly (public keys only; the backend holds the secret
// keys and signs on their behalf for the demo's real on-chain actions).
export const WALLETS = {
  A: { name: "Wallet A", addr: "BVjfgSY3Qhjcuu5NfDXGsAeyocw2UDFZubATb8VHa5GA" },
  B: { name: "Wallet B", addr: "7dDqFTK1XTwEmBhAMYV9nip99HzXqH5uxBwowZzq5pBa" },
  C: { name: "Wallet C", addr: "FKfSxXeQJaUVFKfXTz7xcYz1jWp7cvZSgXoKRQEksc3v" },
} as const;

export type WalletKey = keyof typeof WALLETS;

export const PROGRAMS = {
  eligibilityCredential: "HeopPJru1XZ7AHXDack1mtLSLKFejvRyLsrJZtJoz1bq",
  transferHook: "F9p71yDgPkb3u6FM8jVaGWqQgDY2z6hGmHLof8FANr4z",
  eligibilityMpc: "4Fdcz9uK5SKnH5X5XAfwfH1bD1oefpz3LLLRbaN7zTbh",
};

export const ISSUER_SHORT = "3iWQ… 9Cne";

export const BACKEND_HTTP = import.meta.env.VITE_BACKEND_HTTP ?? "http://localhost:8787";
export const BACKEND_WS = import.meta.env.VITE_BACKEND_WS ?? "ws://localhost:8787";

export const DAY = 86400000;

export function short(addr: string): string {
  return addr.slice(0, 4) + "…" + addr.slice(-4);
}

export function dstr(unixSecs: number): string {
  return new Date(unixSecs * 1000).toISOString().slice(0, 10);
}

export function fmtT(ms: number): string {
  return new Date(ms).toTimeString().slice(0, 8);
}
