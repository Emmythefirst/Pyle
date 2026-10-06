import { BACKEND_HTTP } from "./constants";
import type { BuyResult, CredentialView, PyleState, VerifyResult } from "./types";

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${BACKEND_HTTP}${path}`);
  if (!res.ok) throw new Error(`GET ${path} -> ${res.status}`);
  return res.json() as Promise<T>;
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BACKEND_HTTP}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json() as Promise<T>;
}

export const api = {
  getState: () => getJson<PyleState>("/state"),
  getCredential: (wallet: string) => getJson<CredentialView>(`/credential/${wallet}`),
  getCredentials: () => getJson<CredentialView[]>("/credentials"),
  buy: (wallet: string, amount: number) => postJson<BuyResult>("/buy", { wallet, amount }),
  verify: (wallet: string, income: number, netWorth: number) =>
    postJson<VerifyResult>("/verify", { wallet, income, netWorth }),
  revoke: (wallet: string) => postJson<{ ok: boolean; signature?: string; error?: string }>("/revoke", { wallet }),
};
