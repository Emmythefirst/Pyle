/**
 * Devnet's public RPC throws plain objects (not Error instances) under some
 * conditions -- confirmed directly: a 429-rate-limited confirmTransaction
 * call surfaced as a bare `{ InstructionError: [...] }` object, which
 * `String(err)` collapses to the useless "[object Object]". Falls back to
 * JSON.stringify for anything that isn't a real Error.
 */
export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}
