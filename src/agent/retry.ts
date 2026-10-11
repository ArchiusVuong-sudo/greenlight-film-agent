const RETRYABLE = /(overloaded|rate[ _-]?limit|too many requests|\b429\b|\b5\d\d\b|server[ _]error|internal error|timed? ?out|ECONNRESET|socket hang up)/i;
const AUTH = /(authentication_failed|invalid api key|not logged in|please run \/login|oauth|unauthori[sz]ed|\b401\b)/i;

export function isRetryable(message: string): boolean {
  return RETRYABLE.test(message);
}

export function isAuthError(message: string): boolean {
  return AUTH.test(message);
}

/** Exponential backoff with full jitter: attempt 1 waits up to 2 s, then 4, 8, 16, capped at 30 s. */
export function backoffMs(attempt: number, random: () => number = Math.random, baseMs = 2000, capMs = 30_000): number {
  const ceiling = Math.min(capMs, baseMs * 2 ** Math.max(0, attempt - 1));
  return Math.round(ceiling / 2 + (random() * ceiling) / 2);
}

export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  opts: { attempts?: number; onRetry?: (attempt: number, delayMs: number, error: Error) => void; sleep?: (ms: number) => Promise<void>; random?: () => number } = {},
): Promise<T> {
  const attempts = opts.attempts ?? 4;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn(attempt);
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      if (attempt >= attempts || !isRetryable(err.message)) throw err;
      const delay = backoffMs(attempt, opts.random);
      opts.onRetry?.(attempt, delay, err);
      await sleep(delay);
    }
  }
}
