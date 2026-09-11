/**
 * RatePacer: In-memory async queue / throttle per key (e.g. provider:connectionId).
 * Enforces a minimum interval (default 1000ms) between consecutive outbound requests.
 */
export class RatePacer {
  constructor(defaultMinIntervalMs = 1000) {
    this.defaultMinIntervalMs = defaultMinIntervalMs;
    this.queues = new Map(); // key -> Promise chain
    this.lastRunTimes = new Map(); // key -> timestamp
  }

  async acquire(key, minIntervalMs = this.defaultMinIntervalMs) {
    if (!key) return;

    const previousPromise = this.queues.get(key) || Promise.resolve();

    const currentTask = previousPromise.catch(() => {}).then(async () => {
      const now = Date.now();
      const lastRun = this.lastRunTimes.get(key) || 0;
      const elapsed = now - lastRun;
      if (elapsed < minIntervalMs) {
        const delay = minIntervalMs - elapsed;
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
      this.lastRunTimes.set(key, Date.now());
    });

    this.queues.set(key, currentTask);

    try {
      await currentTask;
    } finally {
      // Clean up queue when this is the terminal task
      if (this.queues.get(key) === currentTask) {
        this.queues.delete(key);
      }
    }
  }
}

// Global singleton instance for Gemini rate pacing (1 request per second per connection/proxy)
if (!global._geminiRatePacer) {
  global._geminiRatePacer = new RatePacer(1000);
}

export const geminiRatePacer = global._geminiRatePacer;
