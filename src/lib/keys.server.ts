/**
 * API key access.
 *
 * Images are rendered by Agnes AI (`agnes-image-2.1-flash`) with ONE key, so
 * the old ten-key Pixazo pool is gone. What remains is a small fairness gate:
 * only a limited number of renders may be in flight at once, everything else
 * queues. The key itself lives only in the server environment — it is never
 * written into the codebase and never sent to the browser.
 */

/** How many renders the single Agnes key may run at the same time. */
export const PER_KEY_CONCURRENCY = Number(process.env["AGNES_CONCURRENCY"] ?? 4) || 4;

export function agnesKey(): string {
  const key = process.env["AGNES_API_KEY"]?.trim();
  if (!key) throw new Error("Missing AGNES_API_KEY (Agnes AI key)");
  return key;
}

/** In-flight renders. */
let inFlight = 0;
/** Callers waiting for capacity. */
const waiters: (() => void)[] = [];

/**
 * Leases render capacity for the duration of `fn`. At most
 * PER_KEY_CONCURRENCY images are generated at once; anything beyond waits.
 */
export async function withImageKey<T>(
  _slot: number,
  _attempt: number,
  fn: (key: string, keyIndex: number) => Promise<T>,
): Promise<T> {
  const key = agnesKey();
  while (inFlight >= PER_KEY_CONCURRENCY) {
    // Waiting must never sleep forever: every release wakes ALL waiters, and
    // each wait also times out on its own, so a lost wake-up can't freeze a run.
    await new Promise<void>((resolve) => {
      let done = false;
      const wake = () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(wake, 250);
      waiters.push(wake);
    });
  }
  inFlight++;
  try {
    return await fn(key, 0);
  } finally {
    inFlight = Math.max(0, inFlight - 1);
    const woken = waiters.splice(0, waiters.length);
    for (const w of woken) w();
  }
}
