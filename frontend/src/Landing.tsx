import { useState } from "react";
import { s, C, tint } from "./style";
import { short } from "./constants";
import { Reveal } from "./Reveal";
import type { CredentialsMap } from "./App";
import type { PyleState } from "./types";

const HOW_IT_WORKS = [
  {
    n: "01",
    title: "Private eligibility check",
    body: "An investor's income and net worth are encrypted on their device. Arcium MPC nodes jointly evaluate the accredited-investor rule and reveal only true or false.",
    tech: "eligibility-mpc · check_eligibility_v2",
  },
  {
    n: "02",
    title: "On-chain credential",
    body: "An eligible result lets the issuer write a structured credential for that wallet: policy, issuer, status, issued and expiry times.",
    tech: "EligibilityCredential PDA",
  },
  {
    n: "03",
    title: "Gate on every buy",
    body: "A Token-2022 transfer hook on the ACME mint checks the buyer's credential. Missing, expired or revoked credentials revert the whole transaction.",
    tech: "transfer-hook · Execute",
  },
];

const LIFECYCLE = [
  { tag: "BONDING CURVE", title: "Gate enforced", body: "Initial distribution runs on Meteora DBC. Only credentialed wallets can buy.", dot: C.lime, bg: "#111311" },
  { tag: "CURVE COMPLETE", title: "Hook revoked", body: "In the completing swap, DBC clears the hook program and authority from the mint.", dot: C.amber, bg: "#0f110f" },
  { tag: "DAMM V2", title: "Trades openly", body: "Liquidity migrates to DAMM v2. Like a security restricted at issuance, ACME becomes freely tradable.", dot: C.blue, bg: "#0d0f0d" },
];

const FAQS: [string, string][] = [
  ["Is this real money?", "No. Pyle runs on Solana devnet, so SOL and ACME have no value. ACME is a fictional tokenized stock created for this demo."],
  ["Does Pyle see my income or net worth?", "No. Your numbers are encrypted on your device and evaluated by Arcium MPC nodes. Pyle and the chain only ever see the result: eligible true or false. Inputs here are simulated test data; in production a provider such as Civic would supply them."],
  ["What happens when my buy is blocked?", "The transfer hook returns an error, so the entire transaction reverts atomically. No tokens move beyond the network fee already spent. The terminal logs the attempt with its reason: no credential, expired, or revoked."],
  ["Why does the gate stop after graduation?", "When the bonding curve completes, Meteora DBC revokes the transfer hook from the mint so the pool can migrate into permissionless DAMM v2 liquidity. Eligibility is enforced during the initial sale; after that, assets trade openly, much like a security restricted at issuance."],
  ["How long does a credential last?", "One year from issuance. The hook compares the current time with expires_at on every transfer, and the issuer can revoke a credential at any time."],
  ["Which wallet do I need?", "This demo drives three prepared devnet wallets (A/B/C) directly from the backend so the credential story is visible without needing a browser wallet connected."],
];

function Marquee({ state }: { state: PyleState }) {
  const events = [...state.blockedTransfers, ...state.successfulBuys]
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, 12);

  if (events.length === 0) {
    return (
      <div style={s("display:flex;align-items:center;gap:10px;padding:14px 22px;white-space:nowrap")}>
        <span style={s("font:400 12px 'Geist Mono',monospace;color:#8d8f88")}>Live feed will appear here once a buy runs in the terminal.</span>
      </div>
    );
  }
  const items = [...events, ...events];
  return (
    <>
      {items.map((e, i) => {
        const isBlocked = e.type === "blocked_transfer";
        const badge = isBlocked ? "BLOCKED" : "PASSED";
        const bg = isBlocked ? tint.red : tint.lime;
        const fg = isBlocked ? C.red : C.lime;
        const text = isBlocked
          ? (e as (typeof state.blockedTransfers)[number]).reason
          : "valid credential";
        return (
          <div key={i} style={s("display:flex;align-items:center;gap:10px;padding:14px 22px;border-right:1px solid rgba(236,235,230,0.06);white-space:nowrap")}>
            <span style={{ ...s("font:500 10px 'Geist Mono',monospace;padding:3px 6px;border-radius:4px"), background: bg, color: fg }}>{badge}</span>
            <span style={s("font:400 12px 'Geist Mono',monospace;color:#ecebe6")}>{e.wallet ? short(e.wallet) : "—"}</span>
            <span style={s("font:400 12px 'Geist Mono',monospace;color:#8d8f88")}>{text}</span>
          </div>
        );
      })}
    </>
  );
}

export function Landing({
  goTerminal,
  state,
}: {
  goTerminal: () => void;
  goVerify: () => void;
  state: PyleState;
  credentials: CredentialsMap;
}) {
  const curveLabel = state.poolState.configured
    ? `${(state.poolState.percentComplete ?? 0).toFixed(1)}%`
    : "not configured";

  const stats = [
    { label: "Credentialed wallets", value: String(state.credentialedWalletCount), color: C.lime },
    { label: "Transfers refused by the hook", value: String(state.blockedTransfers.length), color: C.red },
    { label: "ACME curve progress", value: curveLabel, color: C.ink },
    { label: "Financial data stored by Pyle", value: "0 bytes", color: C.ink },
  ];

  return (
    <main
      style={s(
        "flex:1;display:flex;flex-direction:column;overflow-x:clip;background-image:radial-gradient(rgba(236,235,230,0.07) 1px, transparent 1px);background-size:22px 22px",
      )}
    >
      <section style={s("position:relative;max-width:1180px;width:100%;box-sizing:border-box;margin:0 auto;padding:96px 24px 56px;display:flex;flex-direction:column;gap:28px")}>
        <div
          style={s(
            "position:absolute;right:-80px;top:20px;width:520px;height:520px;border-radius:50%;background:radial-gradient(closest-side,rgba(212,242,122,0.10),transparent);pointer-events:none;animation:pyGlow 6s ease-in-out infinite",
          )}
        />
        <span style={s("display:flex;align-items:center;gap:8px;font:500 12px 'Geist Mono',monospace;color:#8d8f88;animation:pyRise .7s both")}>
          <span style={s("width:6px;height:6px;border-radius:50%;background:#d4f27a;animation:pyPulse 2s infinite")} />
          COMPLIANCE FOR METEORA DBC LAUNCHES · πύλη, &ldquo;GATE&rdquo;
        </span>
        <h1 style={s("position:relative;margin:0;font-weight:500;font-size:clamp(40px,6.4vw,84px);line-height:0.98;letter-spacing:-0.045em;max-width:980px;display:flex;flex-wrap:wrap;column-gap:0.24em")}>
          <span style={s("display:inline-block;animation:pyRise .9s .05s both")}>Eligibility,</span>
          <span style={s("display:inline-block;animation:pyRise .9s .15s both")}>enforced</span>
          <span style={s("display:inline-block;animation:pyRise .9s .25s both")}>on</span>
          <span style={s("display:inline-block;animation:pyRise .9s .35s both")}>the</span>
          <span style={s("display:inline-block;animation:pyRise .9s .45s both")}>asset</span>
          <span style={s("display:inline-block;animation:pyRise .9s .6s both;font-family:'Instrument Serif',serif;font-style:italic;font-weight:400;color:#8d8f88")}>
            itself<span style={{ color: C.lime }}>.</span>
          </span>
        </h1>
        <p style={s("position:relative;margin:0;max-width:640px;font-size:17px;line-height:1.55;color:#a9aaa3;animation:pyRise .9s .75s both")}>
          Pyle wires investor eligibility into a token's launch on Meteora. A Token-2022 transfer hook checks every buy against an on-chain credential. The
          launchpad never receives or stores an investor's underlying financial data, only a verifiable eligibility result.
        </p>
        <div style={s("position:relative;display:flex;flex-wrap:wrap;gap:10px;animation:pyRise .9s .9s both")}>
          <button
            onClick={goTerminal}
            className="py-btn-glow"
            style={s("border:0;cursor:pointer;font-weight:500;font-size:14px;padding:13px 18px;border-radius:10px;background:#d4f27a;color:#0b0c0b")}
          >
            Open the ACME terminal
          </button>
          <button
            onClick={goTerminal}
            style={s("border:1px solid rgba(236,235,230,0.16);cursor:pointer;font-weight:500;font-size:14px;padding:13px 18px;border-radius:10px;background:transparent;color:#ecebe6")}
          >
            Check eligibility privately
          </button>
        </div>
      </section>

      <section style={s("padding:0 0 56px;animation:pyFade 1.2s 1.1s both")}>
        <div
          style={s(
            "position:relative;border-top:1px solid rgba(236,235,230,0.08);border-bottom:1px solid rgba(236,235,230,0.08);background:rgba(11,12,11,0.7);overflow:hidden",
          )}
        >
          <div style={s("display:flex;width:max-content;animation:pyMarquee 60s linear infinite")}>
            <Marquee state={state} />
          </div>
        </div>
      </section>

      <section style={s("max-width:1180px;width:100%;box-sizing:border-box;margin:0 auto;padding:0 24px 72px")}>
        <Reveal
          style={s(
            "display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:1px;background:rgba(236,235,230,0.08);border:1px solid rgba(236,235,230,0.08);border-radius:14px;overflow:hidden",
          )}
        >
          {stats.map((st) => (
            <div key={st.label} style={s("background:#111311;padding:20px 22px;display:flex;flex-direction:column;gap:8px")}>
              <span style={s("font-size:12px;color:#8d8f88")}>{st.label}</span>
              <span style={{ ...s("font:500 26px 'Geist Mono',monospace;letter-spacing:-0.02em"), color: st.color }}>{st.value}</span>
            </div>
          ))}
        </Reveal>
      </section>

      <section style={s("max-width:1180px;width:100%;box-sizing:border-box;margin:0 auto;padding:0 24px 88px;display:flex;flex-direction:column;gap:28px")}>
        <Reveal style={s("display:flex;flex-direction:column;gap:8px")}>
          <span style={s("font:500 12px 'Geist Mono',monospace;color:#8d8f88")}>How it works</span>
          <h2 style={s("margin:0;font-weight:500;font-size:clamp(26px,3vw,38px);letter-spacing:-0.03em")}>Three pieces, all on-chain</h2>
        </Reveal>
        <div style={s("display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:16px")}>
          {HOW_IT_WORKS.map((h, i) => (
            <Reveal
              key={h.n}
              delay={i * 120}
              className="py-card-hover"
              style={s(
                "border-radius:14px;padding:24px;display:flex;flex-direction:column;gap:14px",
              )}
            >
              <span style={s("font:500 12px 'Geist Mono',monospace;color:#d4f27a")}>{h.n}</span>
              <span style={s("font-weight:500;font-size:18px;letter-spacing:-0.01em")}>{h.title}</span>
              <span style={s("font-size:14px;line-height:1.55;color:#a9aaa3")}>{h.body}</span>
              <span style={s("font:400 11.5px 'Geist Mono',monospace;color:#6f716b;padding-top:10px;border-top:1px solid rgba(236,235,230,0.06)")}>{h.tech}</span>
            </Reveal>
          ))}
        </div>
      </section>

      <section style={s("max-width:1180px;width:100%;box-sizing:border-box;margin:0 auto;padding:0 24px 96px;display:flex;flex-direction:column;gap:28px")}>
        <Reveal style={s("display:flex;flex-direction:column;gap:8px")}>
          <span style={s("font:500 12px 'Geist Mono',monospace;color:#8d8f88")}>Lifecycle</span>
          <h2 style={s("margin:0;font-weight:500;font-size:clamp(26px,3vw,38px);letter-spacing:-0.03em;max-width:760px")}>
            Restricted at issuance, freely tradable after graduation
          </h2>
        </Reveal>
        <Reveal style={s("position:relative;display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:0;border:1px solid rgba(236,235,230,0.08);border-radius:14px;overflow:hidden")}>
          <div style={s("position:absolute;left:0;right:0;top:0;height:1px;overflow:hidden")}>
            <div style={s("width:40%;height:1px;background:linear-gradient(90deg,transparent,#d4f27a,transparent);animation:pyScan 4s linear infinite")} />
          </div>
          {LIFECYCLE.map((l) => (
            <div key={l.tag} style={{ ...s("padding:24px;display:flex;flex-direction:column;gap:12px;border-right:1px solid rgba(236,235,230,0.08)"), background: l.bg }}>
              <div style={s("display:flex;align-items:center;gap:10px")}>
                <span style={{ ...s("width:10px;height:10px;border-radius:50%"), background: l.dot }} />
                <span style={{ ...s("font:500 12px 'Geist Mono',monospace"), color: l.dot }}>{l.tag}</span>
              </div>
              <span style={s("font-weight:500;font-size:17px")}>{l.title}</span>
              <span style={s("font-size:13.5px;line-height:1.55;color:#a9aaa3")}>{l.body}</span>
            </div>
          ))}
        </Reveal>
        <p style={s("margin:0;max-width:760px;font-size:13px;line-height:1.6;color:#8d8f88")}>
          Meteora DBC revokes the transfer hook in the swap that completes the curve, so the pool can migrate into permissionless DAMM v2 liquidity.
          Eligibility is enforced through the DBC phase; once graduated, the asset trades openly.
        </p>
      </section>

      <section style={s("max-width:1180px;width:100%;box-sizing:border-box;margin:0 auto;padding:24px 24px 120px;display:flex;flex-direction:column;gap:40px")}>
        <Reveal style={s("display:flex;flex-direction:column;gap:14px")}>
          <span style={s("display:flex;align-items:center;gap:8px;font:500 12px 'Geist Mono',monospace;color:#8d8f88")}>
            <span style={s("width:6px;height:6px;border-radius:50%;background:#d4f27a")} />
            QUESTIONS
          </span>
          <h2 style={s("margin:0;font-weight:500;font-size:clamp(36px,5vw,64px);letter-spacing:-0.045em;line-height:1")}>
            FAQ<span style={{ color: C.lime }}>.</span>
          </h2>
        </Reveal>
        <Reveal>
          <FaqList />
        </Reveal>
      </section>

      <section style={s("border-top:1px solid rgba(236,235,230,0.08);position:relative;overflow:hidden")}>
        <div
          style={s(
            "position:absolute;left:50%;top:50%;width:700px;height:400px;transform:translate(-50%,-50%);background:radial-gradient(closest-side,rgba(212,242,122,0.08),transparent);pointer-events:none;animation:pyGlow 5s ease-in-out infinite",
          )}
        />
        <Reveal style={s("position:relative;max-width:1180px;margin:0 auto;padding:140px 24px;display:flex;flex-direction:column;align-items:center;gap:32px;text-align:center")}>
          <h2 style={s("margin:0;font-weight:500;font-size:clamp(40px,6vw,80px);letter-spacing:-0.045em;line-height:1;max-width:900px")}>
            Compliance that travels with the token<span style={{ color: C.lime }}>.</span>
          </h2>
          <button
            onClick={goTerminal}
            className="py-btn-glow"
            style={s("border:0;cursor:pointer;font-weight:500;font-size:14px;padding:13px 20px;border-radius:10px;background:#d4f27a;color:#0b0c0b")}
          >
            Open the terminal
          </button>
        </Reveal>
      </section>

      <footer
        style={s(
          "margin-top:auto;border-top:1px solid rgba(236,235,230,0.06);padding:22px 24px;display:flex;flex-wrap:wrap;gap:8px 20px;justify-content:space-between;font-size:12px;color:#6f716b",
        )}
      >
        <span>Pyle · built for Meteora's DBC track at Colosseum Stocklana</span>
        <span style={s("font-family:'Geist Mono',monospace")}>Meteora DBC · Token-2022 hook · Arcium MPC</span>
      </footer>
    </main>
  );
}

function FaqList() {
  return (
    <div style={s("display:flex;flex-direction:column;border-top:1px solid rgba(236,235,230,0.08)")}>
      {FAQS.map(([q, a]) => (
        <FaqRow key={q} q={q} a={a} />
      ))}
    </div>
  );
}

function FaqRow({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={s("border-bottom:1px solid rgba(236,235,230,0.08)")}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="py-faq-q"
        style={s(
          "width:100%;display:flex;align-items:center;justify-content:space-between;gap:20px;padding:22px 0;border:0;background:transparent;cursor:pointer;text-align:left;font-weight:500;font-size:17px",
        )}
      >
        <span>{q}</span>
        <span style={{ ...s("flex:none;font:400 20px 'Geist Mono',monospace;color:#8d8f88;transition:transform .3s"), transform: open ? "rotate(45deg)" : "rotate(0deg)" }}>+</span>
      </button>
      <div style={{ display: "grid", gridTemplateRows: open ? "1fr" : "0fr", transition: "grid-template-rows .4s cubic-bezier(.2,.7,.2,1)" }}>
        <div style={{ overflow: "hidden" }}>
          <p style={s("margin:0;padding:0 40px 24px 0;max-width:760px;font-size:14.5px;line-height:1.6;color:#a9aaa3")}>{a}</p>
        </div>
      </div>
    </div>
  );
}
