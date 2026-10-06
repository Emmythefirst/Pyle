import { useEffect, useRef, useState } from "react";
import { s, C, tint } from "./style";
import { WALLETS, short, fmtT } from "./constants";
import type { WalletKey } from "./constants";
import { api } from "./api";
import type { CredentialsMap } from "./App";
import type { PyleState, VerifyResult } from "./types";

const T = 85;
const START = 51.3;

function curve(pct: number) {
  const pts: [number, number][] = [];
  for (let i = 0; i <= 40; i++) {
    const x = i / 40;
    pts.push([x * 396, 104 - Math.pow(x, 1.7) * 96]);
  }
  const P = (a: [number, number][]) => "M" + a.map((p) => p[0].toFixed(1) + " " + p[1].toFixed(1)).join(" L");
  const done = pts.slice(0, Math.round(pct * 40) + 1);
  const last = done[done.length - 1];
  return { line: P(pts), done: P(done), fill: P(done) + ` L${last[0].toFixed(1)} 104 L0 104 Z` };
}

function price(quote: number): number {
  const x = quote / T;
  return 0.0000182 * (1 + 3.4 * x * x);
}

const STAGE_NOTES = [
  "Ready. Nothing has left this device.",
  "Encrypting with x25519 + Rescue cipher",
  "Queued to eligibility-mpc → cluster 456",
  "No single node sees income or net worth",
  "Only the boolean is revealed on-chain",
  "issuer bridge → issue_credential",
];

export function Terminal({
  state,
  activeWallet,
  setActiveWallet,
  credentials,
  refreshCredential,
}: {
  state: PyleState;
  activeWallet: WalletKey;
  setActiveWallet: (w: WalletKey) => void;
  credentials: CredentialsMap;
  refreshCredential: (w: WalletKey) => Promise<void>;
}) {
  const [tab, setTab] = useState<"verify" | "cred" | "buy">("buy");
  const [filter, setFilter] = useState<"all" | "block" | "pass">("all");

  // Illustrative only (see progress.md's frontend-build scope decision): no
  // persistent DBC pool exists, so this bonding-curve chart is a local,
  // cosmetic stand-in nudged by real buy activity -- not a real pool read.
  const [quote, setQuote] = useState(START);
  const [phase, setPhase] = useState<"curve" | "complete" | "open">("curve");
  const [grading, setGrading] = useState(false);
  const [gradModal, setGradModal] = useState(false);
  const [gradStep, setGradStep] = useState(0);
  const lastBuyCount = useRef(state.successfulBuys.length);

  useEffect(() => {
    if (state.successfulBuys.length > lastBuyCount.current && phase === "curve") {
      setQuote((q) => Math.min(q + 0.6, T * 0.97));
    }
    lastBuyCount.current = state.successfulBuys.length;
  }, [state.successfulBuys.length, phase]);

  const graduate = () => {
    if (phase !== "curve" || grading) return;
    setGrading(true);
    const iv = setInterval(() => {
      setQuote((q) => {
        const next = Math.min(T, q + 2.4);
        if (next >= T) {
          clearInterval(iv);
          setPhase("complete");
          setGrading(false);
          setGradModal(true);
          setGradStep(1);
          setTimeout(() => setGradStep(2), 1400);
          setTimeout(() => {
            setPhase("open");
            setGradStep(3);
          }, 4400);
        }
        return next;
      });
    }, 220);
  };
  const reset = () => {
    setQuote(START);
    setPhase("curve");
    setGrading(false);
    setGradModal(false);
    setGradStep(0);
  };

  const gradSteps = [
    { title: "Curve complete", detail: `quoteReserve reached ${T} SOL` },
    { title: "Transfer hook revoked", detail: "DBC: TransferHook Update + SetAuthority" },
    { title: "Migrated to DAMM v2", detail: "migrateToDammV2 · pool open (illustrative)" },
  ].map((step, i) => {
    const done = gradStep > i + 1 || gradStep === 3;
    const active = gradStep === i + 1 && gradStep < 3;
    return {
      ...step,
      mark: done ? "✓" : String(i + 1),
      bg: done ? tint.lime : active ? "#ecebe6" : "rgba(236,235,230,0.06)",
      fg: done ? C.lime : active ? "#0b0c0b" : C.dim,
      color: done || active ? C.ink : C.dim,
      anim: active ? "pyPulse 1s infinite" : "none",
    };
  });
  const gradBusy = gradStep < 3;

  const cred = credentials[activeWallet];
  const gated = phase === "curve";
  const pct = Math.min(1, quote / T);
  const cv = curve(pct);
  const stage = gated ? 0 : phase === "complete" ? 1 : 2;
  const phaseLabel = gated ? "gate active" : phase === "complete" ? "curve complete" : "graduated · DAMM v2";
  const phaseColor = gated ? C.lime : phase === "complete" ? C.amber : C.blue;

  const feedRows = [...state.blockedTransfers.map((e) => ({ ...e, kind: "block" as const })), ...state.successfulBuys.map((e) => ({ ...e, kind: "pass" as const }))]
    .sort((a, b) => b.timestamp - a.timestamp)
    .filter((e) => filter === "all" || e.kind === filter)
    .slice(0, 60);

  return (
    <>
    <main style={s("flex:1;display:flex;flex-wrap:wrap;align-items:stretch")}>
      <div style={s("flex:1 1 640px;min-width:0;padding:22px 24px 32px;display:flex;flex-direction:column;gap:18px;box-sizing:border-box")}>
        <div style={s("display:flex;flex-wrap:wrap;align-items:flex-end;justify-content:space-between;gap:16px")}>
          <div style={s("display:flex;align-items:center;gap:14px")}>
            <span style={s("width:44px;height:44px;border-radius:11px;background:#1b1e19;border:1px solid rgba(236,235,230,0.1);display:flex;align-items:center;justify-content:center;font-family:'Instrument Serif',serif;font-size:26px")}>
              A
            </span>
            <div style={s("display:flex;flex-direction:column;gap:3px")}>
              <span style={s("font-weight:500;font-size:22px;letter-spacing:-0.02em")}>
                Acme Industries <span style={s("color:#8d8f88;font-weight:400")}>ACME</span>
              </span>
              <span style={s("font:400 12px 'Geist Mono',monospace;color:#8d8f88")}>
                Class A · tokenized equity · Meteora DBC · <span style={{ color: phaseColor }}>{phaseLabel}</span>
              </span>
            </div>
          </div>
          <div style={s("text-align:right")}>
            <div style={s("font:500 28px 'Geist Mono',monospace;letter-spacing:-0.03em")}>{price(quote).toFixed(7)}</div>
            <div style={s("font:400 12px 'Geist Mono',monospace;color:#8d8f88")}>SOL per ACME (illustrative)</div>
          </div>
        </div>

        <div style={s("display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:1px;background:rgba(236,235,230,0.08);border-radius:12px;overflow:hidden;border:1px solid rgba(236,235,230,0.08)")}>
          {[
            { label: "Blocked transfers", value: String(state.blockedTransfers.length), sub: "rejected by hook", color: C.red },
            { label: "Successful buys", value: String(state.successfulBuys.length), sub: "passed the hook", color: C.lime },
            { label: "Credentialed wallets", value: String(state.credentialedWalletCount), sub: "valid, unexpired", color: C.lime },
            { label: "MPC attestations", value: String(state.mpcAttestations.length), sub: "this session", color: C.ink },
          ].map((st) => (
            <div key={st.label} style={s("background:#111311;padding:14px 16px;display:flex;flex-direction:column;gap:6px")}>
              <span style={s("font-size:11.5px;color:#8d8f88")}>{st.label}</span>
              <span style={{ ...s("font:500 20px 'Geist Mono',monospace"), color: st.color }}>{st.value}</span>
              <span style={s("font:400 10.5px 'Geist Mono',monospace;color:#6f716b")}>{st.sub}</span>
            </div>
          ))}
        </div>

        <div style={s("background:#111311;border:1px solid rgba(236,235,230,0.08);border-radius:12px;padding:16px 18px;display:flex;flex-wrap:wrap;gap:18px;align-items:center")}>
          <div style={s("flex:1 1 320px;min-width:0;display:flex;flex-direction:column;gap:10px")}>
            <div style={s("display:flex;justify-content:space-between;gap:12px;font:400 12px 'Geist Mono',monospace;color:#8d8f88")}>
              <span>Curve to graduation (illustrative)</span>
              <span>
                <span style={{ color: C.lime }}>{(pct * 100).toFixed(1)}%</span> · {quote.toFixed(1)} / {T} SOL
              </span>
            </div>
            <svg viewBox="0 0 400 110" preserveAspectRatio="none" style={s("width:100%;height:96px;display:block")}>
              <line x1="0" y1="104" x2="400" y2="104" stroke="rgba(236,235,230,0.12)" />
              <line x1="396" y1="0" x2="396" y2="104" stroke="rgba(236,235,230,0.2)" strokeDasharray="3 4" />
              <path d={cv.fill} fill="rgba(212,242,122,0.12)" />
              <path d={cv.line} fill="none" stroke="rgba(236,235,230,0.22)" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
              <path d={cv.done} fill="none" stroke="#d4f27a" strokeWidth={2} vectorEffect="non-scaling-stroke" />
            </svg>
            <div style={s("height:5px;background:rgba(236,235,230,0.08);border-radius:999px")}>
              <div style={{ ...s("height:100%;background:#d4f27a;border-radius:999px;transition:width .3s"), width: `${pct * 100}%` }} />
            </div>
          </div>
          <div style={s("flex:0 1 220px;display:flex;flex-direction:column;gap:8px")}>
            {["Curve · gate enforced", "Complete · hook revoked", "DAMM v2 · open"].map((title, i) => {
              const ring = i <= stage ? (i === stage ? phaseColor : C.dim) : "rgba(236,235,230,0.2)";
              const fill = i < stage ? C.dim : i === stage ? phaseColor : "transparent";
              const color = i === stage ? C.ink : i < stage ? C.muted : C.dim;
              return (
                <div key={title} style={{ ...s("display:flex;align-items:center;gap:10px;font-size:12.5px"), color }}>
                  <span style={{ ...s("width:9px;height:9px;border-radius:50%;box-sizing:border-box;border-width:2px;border-style:solid"), borderColor: ring, background: fill }} />
                  {title}
                </div>
              );
            })}
            <div style={s("display:flex;gap:6px;padding-top:6px")}>
              <button
                onClick={graduate}
                disabled={!gated || grading}
                style={{ ...s("flex:1;border:0;cursor:pointer;font-weight:500;font-size:12.5px;padding:9px 10px;border-radius:8px;background:#d4f27a;color:#0b0c0b"), opacity: !gated || grading ? 0.45 : 1 }}
              >
                {grading ? "Graduating…" : gated ? "Run graduation" : "Graduated"}
              </button>
              <button onClick={reset} style={s("border:1px solid rgba(236,235,230,0.14);cursor:pointer;font-size:12.5px;padding:9px 10px;border-radius:8px;background:transparent;color:#ecebe6")}>
                Reset
              </button>
            </div>
          </div>
        </div>

        <div style={s("background:#111311;border:1px solid rgba(236,235,230,0.08);border-radius:12px;display:flex;flex-direction:column;overflow:hidden;min-height:0")}>
          <div style={s("display:flex;flex-wrap:wrap;align-items:center;gap:10px;padding:12px 16px;border-bottom:1px solid rgba(236,235,230,0.08)")}>
            <span style={s("width:7px;height:7px;border-radius:50%;background:#ff6b5b;animation:pyPulse 1.6s infinite")} />
            <span style={s("font-weight:500;font-size:14px")}>Gate feed</span>
            <span style={s("font-size:12px;color:#8d8f88")}>live, real transactions on devnet</span>
            <div style={s("flex:1")} />
            <div style={s("display:flex;gap:4px")}>
              {(["all", "block", "pass"] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  style={{ ...s("border:1px solid rgba(236,235,230,0.1);cursor:pointer;font:500 11px 'Geist Mono',monospace;padding:4px 9px;border-radius:6px"), background: filter === f ? "rgba(236,235,230,0.1)" : "transparent", color: filter === f ? C.ink : C.muted }}
                >
                  {f === "all" ? "All" : f === "block" ? "Blocked" : "Passed"}
                </button>
              ))}
            </div>
          </div>
          <div style={s("display:grid;grid-template-columns:64px 74px minmax(90px,0.8fr) minmax(140px,1.6fr) 80px 90px;gap:12px;padding:9px 16px;font:400 10.5px 'Geist Mono',monospace;color:#6f716b;border-bottom:1px solid rgba(236,235,230,0.05)")}>
            <span>TIME</span>
            <span>RESULT</span>
            <span>WALLET</span>
            <span>REASON</span>
            <span style={s("text-align:right")}>AMOUNT</span>
            <span style={s("text-align:right")}>TX</span>
          </div>
          <div style={s("max-height:420px;overflow:auto")}>
            {feedRows.length === 0 && (
              <div style={s("padding:24px 16px;font-size:12.5px;color:#6f716b")}>No activity yet. Buy from the panel on the right to populate this feed.</div>
            )}
            {feedRows.map((e) => {
              const isBlocked = e.kind === "block";
              const amount = e.amount ? (Number(e.amount) / 1e6).toFixed(2) + " ACME" : "—";
              return (
                <div
                  key={e.signature}
                  style={{
                    ...s(
                      "display:grid;grid-template-columns:64px 74px minmax(90px,0.8fr) minmax(140px,1.6fr) 80px 90px;gap:12px;align-items:center;padding:9px 16px;border-bottom:1px solid rgba(236,235,230,0.05);animation:pyIn .35s ease-out",
                    ),
                    background: isBlocked ? "rgba(255,107,91,0.035)" : "transparent",
                  }}
                >
                  <span style={s("font:400 11.5px 'Geist Mono',monospace;color:#6f716b")}>{fmtT(e.timestamp)}</span>
                  <span
                    style={{
                      ...s("justify-self:start;font:500 10px 'Geist Mono',monospace;padding:3px 6px;border-radius:4px"),
                      background: isBlocked ? tint.red : tint.lime,
                      color: isBlocked ? C.red : C.lime,
                    }}
                  >
                    {isBlocked ? "BLOCKED" : "PASSED"}
                  </span>
                  <span style={s("font:400 12px 'Geist Mono',monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap")}>{e.wallet ? short(e.wallet) : "—"}</span>
                  <span style={s("font-size:12.5px;color:#a9aaa3;min-width:0")}>{isBlocked ? (e as (typeof state.blockedTransfers)[number]).reason : "Valid credential"}</span>
                  <span style={s("text-align:right;font:500 12px 'Geist Mono',monospace")}>{amount}</span>
                  <a
                    href={`https://explorer.solana.com/tx/${e.signature}?cluster=devnet`}
                    target="_blank"
                    rel="noreferrer"
                    style={s("text-align:right;font:400 11px 'Geist Mono',monospace;color:#8d8f88;text-decoration:none")}
                  >
                    {short(e.signature)}
                  </a>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <aside style={s("flex:1 1 340px;max-width:420px;min-width:300px;border-left:1px solid rgba(236,235,230,0.08);background:#0e100e;padding:20px;display:flex;flex-direction:column;gap:16px;box-sizing:border-box")}>
        <div style={s("display:flex;align-items:center;justify-content:space-between;gap:10px")}>
          <span style={s("font:500 11.5px 'Geist Mono',monospace;color:#8d8f88")}>YOUR ACCESS</span>
          <div style={s("display:flex;gap:3px")}>
            {(Object.keys(WALLETS) as WalletKey[]).map((k) => {
              const c = credentials[k];
              const dot = !c || !c.exists ? C.red : c.status === "Valid" && (c.expiresAt ?? 0) > Date.now() / 1000 ? C.lime : C.amber;
              const activeK = k === activeWallet;
              return (
                <button
                  key={k}
                  title={WALLETS[k].addr}
                  onClick={() => {
                    setActiveWallet(k);
                    void refreshCredential(k);
                  }}
                  style={{
                    ...s("display:flex;align-items:center;gap:6px;cursor:pointer;padding:5px 8px;border-radius:7px;font:500 11.5px 'Geist Mono',monospace;border-width:1px;border-style:solid"),
                    borderColor: activeK ? "rgba(236,235,230,0.18)" : "rgba(236,235,230,0.06)",
                    background: activeK ? "rgba(236,235,230,0.08)" : "transparent",
                    color: activeK ? C.ink : C.muted,
                  }}
                >
                  <span style={{ ...s("width:6px;height:6px;border-radius:50%"), background: dot }} />
                  {k}
                </button>
              );
            })}
          </div>
        </div>
        <div style={s("display:flex;gap:4px;padding:3px;background:#161815;border-radius:9px")}>
          {(["verify", "cred", "buy"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              style={{ ...s("flex:1;border:0;cursor:pointer;padding:7px;border-radius:7px;font-size:12.5px"), background: tab === t ? "#ecebe6" : "transparent", color: tab === t ? "#0b0c0b" : C.muted }}
            >
              {t === "verify" ? "Verify" : t === "cred" ? "Credential" : "Buy"}
            </button>
          ))}
        </div>

        {tab === "verify" && (
          <VerifyPanel
            wallet={activeWallet}
            onIssued={() => {
              void refreshCredential(activeWallet);
            }}
          />
        )}
        {tab === "cred" && <CredentialPanel wallet={activeWallet} cred={cred} goVerify={() => setTab("verify")} />}
        {tab === "buy" && (
          <BuyPanel
            wallet={activeWallet}
            cred={cred}
            gated={gated}
            onBought={() => {
              void refreshCredential(activeWallet);
            }}
            goVerify={() => setTab("verify")}
          />
        )}
      </aside>
    </main>
    {gradModal && (
      <div style={s("position:fixed;inset:0;z-index:20;background:rgba(6,7,6,0.78);backdrop-filter:blur(8px);display:flex;align-items:center;justify-content:center;padding:24px;animation:pyFade .3s")}>
        <div style={s("width:100%;max-width:560px;background:#111311;border:1px solid rgba(236,235,230,0.12);border-radius:18px;padding:30px;display:flex;flex-direction:column;gap:22px;box-shadow:0 30px 80px rgba(0,0,0,0.5)")}>
          <div style={s("display:flex;flex-direction:column;gap:10px")}>
            <span style={{ ...s("font:500 12px 'Geist Mono',monospace"), color: gradStep < 3 ? C.amber : C.blue }}>
              {gradStep < 3 ? "GRADUATING…" : "GRADUATED · DAMM V2"}
            </span>
            <span style={s("font-weight:500;font-size:30px;letter-spacing:-0.03em;line-height:1.1")}>
              ACME has <span style={s("font-family:'Instrument Serif',serif;font-style:italic;font-weight:400")}>graduated</span>
            </span>
            <span style={s("font-size:14px;line-height:1.55;color:#a9aaa3")}>
              The curve reached its {T} SOL threshold (illustrative). Meteora DBC revokes the transfer hook in the completing swap and migrates liquidity into a
              DAMM v2 pool. ACME trades openly from here.
            </span>
          </div>
          <div style={s("display:flex;flex-direction:column")}>
            {gradSteps.map((g, i) => (
              <div key={i} style={s("display:grid;grid-template-columns:24px 1fr;gap:12px;padding:10px 0;border-top:1px solid rgba(236,235,230,0.06)")}>
                <span
                  style={{
                    ...s(
                      "width:20px;height:20px;border-radius:50%;display:flex;align-items:center;justify-content:center;font:500 10.5px 'Geist Mono',monospace",
                    ),
                    background: g.bg,
                    color: g.fg,
                    animation: g.anim,
                  }}
                >
                  {g.mark}
                </span>
                <span style={s("display:flex;flex-direction:column;gap:2px")}>
                  <span style={{ ...s("font-size:13.5px"), color: g.color }}>{g.title}</span>
                  <span style={s("font:400 11px 'Geist Mono',monospace;color:#6f716b")}>{g.detail}</span>
                </span>
              </div>
            ))}
          </div>
          <div style={s("display:flex;gap:8px")}>
            <button
              onClick={() => setGradModal(false)}
              disabled={gradBusy}
              style={{ ...s("flex:1;border:0;cursor:pointer;font-weight:500;font-size:14px;padding:12px;border-radius:10px;background:#ecebe6;color:#0b0c0b"), opacity: gradBusy ? 0.5 : 1 }}
            >
              Back to terminal
            </button>
          </div>
        </div>
      </div>
    )}
    </>
  );
}

function VerifyPanel({ wallet, onIssued }: { wallet: WalletKey; onIssued: () => void }) {
  const [income, setIncome] = useState("250000");
  const [netWorth, setNetWorth] = useState("400000");
  const [step, setStep] = useState(-1);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<VerifyResult | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const clearTimers = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  };

  const runCheck = async () => {
    if (running) return;
    clearTimers();
    setResult(null);
    setRunning(true);
    setStep(0);
    [
      [1, 600],
      [2, 1800],
      [3, 4000],
    ].forEach(([n, at]) => {
      timers.current.push(setTimeout(() => setStep(n), at));
    });

    const incomeNum = Number(income.replace(/\D/g, "")) || 0;
    const netWorthNum = Number(netWorth.replace(/\D/g, "")) || 0;
    try {
      const res = await api.verify(wallet, incomeNum, netWorthNum);
      clearTimers();
      setStep(res.eligible ? 4 : 5);
      setResult(res);
      if (res.credentialIssued) onIssued();
    } catch (err) {
      clearTimers();
      setStep(-1);
      setResult({ eligible: false, checkSig: "", finalizeSig: "", credentialIssued: false, credentialSig: String(err) });
    } finally {
      setRunning(false);
      setStep((s2) => (s2 < 5 ? 5 : s2));
    }
  };

  useEffect(() => clearTimers, []);

  const revealed = step >= 4 && result !== null;
  const hasResult = step === 5 || (step === 4 && result !== null);

  const cipherChips = [
    ["income", income],
    ["net_worth", netWorth],
  ].map(([label, v]) => {
    const enc = step >= 0;
    return {
      label: enc ? label + " · encrypted" : label,
      value: enc ? "0x" + "•".repeat(24) : "$" + (v || "0"),
      color: enc ? C.lime : C.ink,
      border: enc ? "rgba(212,242,122,0.3)" : "rgba(236,235,230,0.1)",
      bg: enc ? "rgba(212,242,122,0.04)" : "transparent",
    };
  });
  const nodes = ["node 1", "node 2"].map((name) => ({
    name,
    note: step < 1 ? "idle" : step === 1 ? "share received" : step === 2 ? "computing" : "done",
    dot: step < 1 ? C.dim : step === 2 ? C.amber : C.lime,
    anim: step === 2 ? "pyPulse .9s infinite" : "none",
    bg: step >= 1 ? "rgba(236,235,230,0.04)" : "transparent",
    border: step === 2 ? "rgba(242,184,75,0.35)" : step >= 1 ? "rgba(236,235,230,0.14)" : "rgba(236,235,230,0.07)",
  }));
  const stageNote = hasResult && result ? (result.eligible ? "Credential issued by the issuer bridge" : "Recorded eligible = false. Nothing issued.") : STAGE_NOTES[step + 1] ?? STAGE_NOTES[0];

  return (
    <div style={s("display:flex;flex-direction:column;gap:14px;animation:pyFade .25s")}>
      <div style={s("display:flex;flex-direction:column;gap:6px")}>
        <span style={s("font-weight:500;font-size:16px")}>Prove eligibility privately</span>
        <span style={s("font-size:12.5px;line-height:1.5;color:#8d8f88")}>
          Inputs are encrypted on this device. Real Arcium MPC nodes on devnet cluster 456 evaluate the rule; only the yes/no result is revealed on-chain.
        </span>
      </div>
      <div style={s("display:flex;flex-direction:column;gap:10px")}>
        <label style={s("display:flex;flex-direction:column;gap:6px")}>
          <span style={s("font-size:12px;color:#8d8f88")}>Annual income (USD)</span>
          <span style={s("display:flex;align-items:center;gap:6px;padding:10px 12px;border:1px solid rgba(236,235,230,0.12);border-radius:9px;background:#0b0c0b")}>
            <span style={s("font:400 14px 'Geist Mono',monospace;color:#6f716b")}>$</span>
            <input
              value={income}
              onChange={(e) => setIncome(e.target.value.replace(/[^\d,]/g, ""))}
              inputMode="numeric"
              style={s("flex:1;min-width:0;border:0;background:transparent;color:#ecebe6;font:500 16px 'Geist Mono',monospace")}
            />
          </span>
        </label>
        <label style={s("display:flex;flex-direction:column;gap:6px")}>
          <span style={s("font-size:12px;color:#8d8f88")}>Net worth (USD)</span>
          <span style={s("display:flex;align-items:center;gap:6px;padding:10px 12px;border:1px solid rgba(236,235,230,0.12);border-radius:9px;background:#0b0c0b")}>
            <span style={s("font:400 14px 'Geist Mono',monospace;color:#6f716b")}>$</span>
            <input
              value={netWorth}
              onChange={(e) => setNetWorth(e.target.value.replace(/[^\d,]/g, ""))}
              inputMode="numeric"
              style={s("flex:1;min-width:0;border:0;background:transparent;color:#ecebe6;font:500 16px 'Geist Mono',monospace")}
            />
          </span>
        </label>
        <span style={s("font:400 11.5px 'Geist Mono',monospace;color:#8d8f88;padding:8px 10px;border-radius:8px;background:rgba(236,235,230,0.03)")}>
          income &gt; 200k <span style={{ color: C.lime }}>OR</span> net_worth &gt; 1M · <span style={{ color: C.amber }}>test data</span>
        </span>
      </div>

      <div style={s("display:flex;flex-direction:column;gap:0;padding:14px;border-radius:12px;border:1px solid rgba(236,235,230,0.08);background:#0b0c0b")}>
        <div style={s("display:flex;gap:6px")}>
          {cipherChips.map((c) => (
            <div key={c.label} style={{ ...s("flex:1;min-width:0;display:flex;flex-direction:column;gap:3px;padding:8px;border-radius:8px;border-width:1px;border-style:solid"), borderColor: c.border, background: c.bg }}>
              <span style={s("font:400 10px 'Geist Mono',monospace;color:#6f716b")}>{c.label}</span>
              <span style={{ ...s("font:500 11px 'Geist Mono',monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"), color: c.color }}>{c.value}</span>
            </div>
          ))}
        </div>
        <div style={s("height:22px;display:flex;justify-content:center")}>
          <span style={{ ...s("width:1px"), background: step >= 1 ? C.lime : "rgba(236,235,230,0.12)" }} />
        </div>
        <div style={{ ...s("display:flex;flex-direction:column;gap:6px;padding:10px;border-radius:10px;border-width:1px;border-style:dashed"), borderColor: step >= 1 && step <= 2 ? "rgba(242,184,75,0.4)" : step >= 3 ? "rgba(212,242,122,0.3)" : "rgba(236,235,230,0.12)" }}>
          <span style={s("font:400 10px 'Geist Mono',monospace;color:#6f716b;text-align:center")}>ARCIUM CLUSTER 456</span>
          <div style={s("display:flex;gap:6px")}>
            {nodes.map((nd) => (
              <div key={nd.name} style={{ ...s("flex:1;display:flex;flex-direction:column;align-items:center;gap:4px;padding:8px 6px;border-radius:8px;border-width:1px;border-style:solid"), background: nd.bg, borderColor: nd.border }}>
                <span style={{ ...s("width:8px;height:8px;border-radius:50%"), background: nd.dot, animation: nd.anim }} />
                <span style={s("font:500 11px 'Geist Mono',monospace")}>{nd.name}</span>
                <span style={s("font:400 10px 'Geist Mono',monospace;color:#6f716b")}>{nd.note}</span>
              </div>
            ))}
          </div>
        </div>
        <div style={s("height:22px;display:flex;justify-content:center")}>
          <span style={{ ...s("width:1px"), background: revealed ? C.lime : "rgba(236,235,230,0.12)" }} />
        </div>
        <div
          style={{
            ...s("align-self:center;font:500 13px 'Geist Mono',monospace;padding:8px 14px;border-radius:999px;border-width:1px;border-style:solid"),
            borderColor: revealed ? (result?.eligible ? "rgba(212,242,122,0.4)" : "rgba(255,107,91,0.4)") : "rgba(236,235,230,0.12)",
            color: revealed ? (result?.eligible ? C.lime : C.red) : C.dim,
            background: revealed ? (result?.eligible ? tint.lime : tint.red) : "transparent",
          }}
        >
          {revealed ? `eligible = ${result?.eligible}` : "eligible = ?"}
        </div>
        <span style={s("text-align:center;font:400 11px 'Geist Mono',monospace;color:#6f716b;padding-top:10px")}>{stageNote}</span>
      </div>

      <button
        onClick={runCheck}
        disabled={running}
        style={{ ...s("border:0;cursor:pointer;font-weight:500;font-size:14px;padding:12px;border-radius:10px;background:#ecebe6;color:#0b0c0b"), opacity: running ? 0.5 : 1 }}
      >
        {running ? "Computing privately… (real devnet round trip, up to ~1 min)" : hasResult ? "Run again" : "Compute privately"}
      </button>
      {hasResult && result && (
        <div
          style={{
            ...s("padding:12px 14px;border-radius:10px;border-width:1px;border-style:solid;display:flex;flex-direction:column;gap:4px;animation:pyIn .35s ease-out"),
            background: result.eligible ? "rgba(212,242,122,0.06)" : "rgba(255,107,91,0.06)",
            borderColor: result.eligible ? "rgba(212,242,122,0.25)" : "rgba(255,107,91,0.25)",
          }}
        >
          <span style={{ ...s("font-weight:500;font-size:13.5px"), color: result.eligible ? C.lime : C.red }}>
            {result.eligible ? "Eligible. Credential issued." : "Not eligible. No credential issued."}
          </span>
          <span style={s("font-size:12.5px;line-height:1.5;color:#a9aaa3")}>
            {result.eligible
              ? `${WALLETS[wallet].name} now holds a Valid US_ACCREDITED credential for one year.`
              : "Neither threshold was met. The chain recorded eligible = false and nothing else."}
          </span>
          {result.finalizeSig && (
            <span style={s("font:400 10.5px 'Geist Mono',monospace;color:#6f716b;word-break:break-all")}>tx {short(result.finalizeSig)}</span>
          )}
        </div>
      )}
      <span style={s("font-size:11.5px;line-height:1.5;color:#6f716b")}>
        Inputs are simulated test data. In production a provider such as Civic would supply them; Pyle never receives the underlying data either way.
      </span>
    </div>
  );
}

function CredentialPanel({
  wallet,
  cred,
  goVerify,
}: {
  wallet: WalletKey;
  cred: CredentialsMap[WalletKey];
  goVerify: () => void;
}) {
  if (!cred) {
    return <div style={s("font-size:12.5px;color:#8d8f88")}>Loading credential…</div>;
  }
  const isValid = cred.exists && cred.status === "Valid" && (cred.expiresAt ?? 0) > Date.now() / 1000;
  const isExpired = cred.exists && (cred.status === "Expired" || (cred.status === "Valid" && (cred.expiresAt ?? 0) <= Date.now() / 1000));
  const statusLabel = !cred.exists ? "NONE" : cred.status === "Revoked" ? "REVOKED" : isExpired ? "EXPIRED" : "VALID";
  const badgeColor = statusLabel === "VALID" ? C.lime : statusLabel === "EXPIRED" ? C.amber : C.red;
  const badgeBg = statusLabel === "VALID" ? tint.lime : statusLabel === "EXPIRED" ? tint.amber : tint.red;
  const borderColor = isValid ? "rgba(212,242,122,0.3)" : "rgba(236,235,230,0.08)";

  const fields: [string, string][] = cred.exists
    ? [
        ["wallet", short(WALLETS[wallet].addr)],
        ["policy_id", "US_ACCREDITED"],
        ["status", cred.status ?? "—"],
        ["issued_at", cred.issuedAt ? new Date(cred.issuedAt * 1000).toISOString().slice(0, 10) : "—"],
        ["expires_at", cred.expiresAt ? new Date(cred.expiresAt * 1000).toISOString().slice(0, 10) : "—"],
      ]
    : [
        ["wallet", short(WALLETS[wallet].addr)],
        ["account", "not initialized"],
        ["policy_id", "US_ACCREDITED"],
      ];

  const explain = !cred.exists
    ? "No credential account exists for this wallet. Any buy will fail with AccountNotInitialized."
    : isValid
      ? "This wallet can buy ACME on the curve. The hook reads this account on every transfer."
      : isExpired
        ? "Status is Valid, but expires_at is in the past. The hook compares timestamps at check time, so buys fail with CredentialExpired."
        : "The issuer revoked this credential. Buys fail with CredentialRevoked.";

  return (
    <div style={s("display:flex;flex-direction:column;gap:14px;animation:pyFade .25s")}>
      <div style={{ ...s("border-radius:14px;padding:18px;background:linear-gradient(160deg,#181b15,#111311);border-width:1px;border-style:solid;display:flex;flex-direction:column;gap:16px"), borderColor }}>
        <div style={s("display:flex;justify-content:space-between;align-items:flex-start;gap:10px")}>
          <div style={s("display:flex;flex-direction:column;gap:4px")}>
            <span style={s("font:400 10.5px 'Geist Mono',monospace;color:#6f716b")}>EligibilityCredential</span>
            <span style={s("font-family:'Instrument Serif',serif;font-size:26px;line-height:1")}>US Accredited</span>
          </div>
          <span style={{ ...s("font:500 10.5px 'Geist Mono',monospace;padding:3px 8px;border-radius:999px"), background: badgeBg, color: badgeColor }}>{statusLabel}</span>
        </div>
        <div style={s("display:flex;flex-direction:column;gap:9px;font:400 12px 'Geist Mono',monospace")}>
          {fields.map(([k, v]) => (
            <div key={k} style={s("display:flex;justify-content:space-between;gap:12px;padding-bottom:9px;border-bottom:1px solid rgba(236,235,230,0.06)")}>
              <span style={s("color:#6f716b")}>{k}</span>
              <span style={s("text-align:right")}>{v}</span>
            </div>
          ))}
        </div>
        <span style={s("font:400 10.5px 'Geist Mono',monospace;color:#6f716b")}>PDA ["eligibility", wallet, policy_id]</span>
      </div>
      <span style={s("font-size:12.5px;line-height:1.5;color:#a9aaa3")}>{explain}</span>
      {!isValid && (
        <button onClick={goVerify} style={s("border:1px solid rgba(236,235,230,0.14);cursor:pointer;font-size:13px;padding:10px;border-radius:9px;background:transparent;color:#ecebe6")}>
          Check eligibility
        </button>
      )}
    </div>
  );
}

function BuyPanel({
  wallet,
  cred,
  gated,
  onBought,
  goVerify,
}: {
  wallet: WalletKey;
  cred: CredentialsMap[WalletKey];
  gated: boolean;
  onBought: () => void;
  goVerify: () => void;
}) {
  const [amount, setAmount] = useState("10");
  const [busy, setBusy] = useState(false);
  const [trade, setTrade] = useState<{ ok: boolean; title: string; detail: string; sig?: string } | null>(null);

  const isValid = !!cred?.exists && cred.status === "Valid" && (cred.expiresAt ?? 0) > Date.now() / 1000;
  const checks = [
    { title: "credential exists", ok: !!cred?.exists },
    { title: "status is Valid", ok: cred?.status === "Valid" },
    { title: "now < expires_at", ok: !!cred && (cred.expiresAt ?? 0) > Date.now() / 1000 },
  ];

  const buy = async () => {
    setBusy(true);
    setTrade(null);
    try {
      const amt = Math.max(0, Number(amount) || 0);
      const res = await api.buy(wallet, amt);
      if (res.ok) {
        setTrade({ ok: true, title: "Buy confirmed", detail: `${amt} ACME transferred from the treasury. The transfer hook found a valid credential.`, sig: res.signature });
        onBought();
      } else {
        setTrade({ ok: false, title: "Transaction reverted", detail: "The hook rejected this transfer. See the gate feed for the exact reason.", sig: res.signature });
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={s("display:flex;flex-direction:column;gap:12px;animation:pyFade .25s")}>
      <div style={s("padding:14px;border-radius:12px;background:#0b0c0b;border:1px solid rgba(236,235,230,0.1);display:flex;flex-direction:column;gap:6px")}>
        <span style={s("font-size:12px;color:#8d8f88")}>Amount to buy</span>
        <div style={s("display:flex;justify-content:space-between;align-items:center;gap:10px")}>
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))}
            inputMode="decimal"
            style={s("flex:1;min-width:0;border:0;background:transparent;color:#ecebe6;font:500 26px 'Geist Mono',monospace")}
          />
          <span style={s("font-size:13px;padding:4px 10px;border-radius:999px;background:rgba(236,235,230,0.07)")}>ACME</span>
        </div>
      </div>
      <div style={s("display:flex;flex-direction:column;gap:6px;padding:4px 2px")}>
        <span style={s("font-size:12px;color:#8d8f88")}>{gated ? "The transfer hook will check:" : "Hook revoked at graduation. No checks run."}</span>
        {checks.map((ck) => (
          <div key={ck.title} style={s("display:flex;align-items:center;gap:8px;font:400 12px 'Geist Mono',monospace;color:#a9aaa3")}>
            <span style={{ ...s("width:16px;text-align:center"), color: ck.ok ? C.lime : C.red }}>{ck.ok ? "✓" : "✕"}</span>
            <span style={s("flex:1")}>{ck.title}</span>
            <span style={{ ...s("font-size:10.5px"), color: ck.ok ? C.lime : C.red }}>{ck.ok ? "PASS" : "FAIL"}</span>
          </div>
        ))}
      </div>
      <button
        onClick={buy}
        disabled={busy}
        style={{ ...s("border:0;cursor:pointer;font-weight:500;font-size:14px;padding:13px;border-radius:10px;background:#d4f27a;color:#0b0c0b"), opacity: busy ? 0.6 : 1 }}
      >
        {busy ? "Submitting…" : `Buy ACME as ${WALLETS[wallet].name}`}
      </button>
      {trade && (
        <div
          style={{
            ...s("padding:12px 14px;border-radius:10px;border-width:1px;border-style:solid;display:flex;flex-direction:column;gap:4px;animation:pyIn .35s ease-out"),
            background: trade.ok ? "rgba(212,242,122,0.06)" : "rgba(255,107,91,0.06)",
            borderColor: trade.ok ? "rgba(212,242,122,0.25)" : "rgba(255,107,91,0.25)",
          }}
        >
          <span style={{ ...s("font-weight:500;font-size:13.5px"), color: trade.ok ? C.lime : C.red }}>{trade.title}</span>
          <span style={s("font-size:12.5px;line-height:1.5;color:#a9aaa3")}>{trade.detail}</span>
          {trade.sig && (
            <a href={`https://explorer.solana.com/tx/${trade.sig}?cluster=devnet`} target="_blank" rel="noreferrer" style={s("font:400 10.5px 'Geist Mono',monospace;color:#6f716b;word-break:break-all")}>
              tx {trade.sig}
            </a>
          )}
        </div>
      )}
      {!isValid && (
        <button onClick={goVerify} style={s("border:0;background:transparent;cursor:pointer;font-size:12.5px;color:#8d8f88;text-decoration:underline;text-underline-offset:3px")}>
          No valid credential? Check eligibility privately
        </button>
      )}
    </div>
  );
}
