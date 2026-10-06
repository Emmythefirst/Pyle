import type { CSSProperties } from "react";

/**
 * Lets every component literally copy-paste the inline `style="..."` strings
 * pulled from the original design artifact instead of hand-converting ~250
 * declarations to camelCase JS objects -- a straight transcription error
 * magnet at this scale. Declarations never contain a top-level colon other
 * than the prop/value separator in this design (no raw url(http://...) in
 * any inline style, only in <style> blocks), so splitting on the first ':'
 * per ';'-separated declaration is safe.
 */
export function s(css: string): CSSProperties {
  const obj: Record<string, string> = {};
  for (const decl of css.split(";")) {
    const idx = decl.indexOf(":");
    if (idx === -1) continue;
    const prop = decl.slice(0, idx).trim();
    const value = decl.slice(idx + 1).trim();
    if (!prop || !value) continue;
    const camel = prop.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
    obj[camel] = value;
  }
  return obj as CSSProperties;
}

// Design tokens, transcribed verbatim from the extracted artifact's `C` /
// `tint` constants (template_raw.html line ~746-747).
export const C = {
  ink: "#ecebe6",
  muted: "#8d8f88",
  dim: "#6f716b",
  lime: "#d4f27a",
  red: "#ff6b5b",
  amber: "#f2b84b",
  blue: "#8fb7ff",
};

export const tint = {
  lime: "rgba(212,242,122,0.13)",
  red: "rgba(255,107,91,0.13)",
  amber: "rgba(242,184,75,0.14)",
  blue: "rgba(143,183,255,0.13)",
  ink: "rgba(236,235,230,0.08)",
};
