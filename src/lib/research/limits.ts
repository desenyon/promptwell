import { HttpError } from "../http.ts";

interface LimitsConfig { monthlyRequestCap: number; rateLimitRequests: number; rateLimitWindowMs: number }

/** Single-process backstop. Reservations count in-flight calls; not a distributed billing ledger. */
export class ResearchLimits {
  private users = new Map<string, { count: number; resetAt: number }>();
  private usage = { month: "", requests: 0 };
  private now: () => number;
  private maxUsers: number;

  constructor(now = Date.now, maxUsers = 10_000) { this.now = now; this.maxUsers = maxUsers; }

  reserve(userId: string, config: LimitsConfig) {
    const now = this.now();
    for (const [id, entry] of this.users) if (entry.resetAt <= now) this.users.delete(id);
    let entry = this.users.get(userId);
    if (!entry) {
      if (this.users.size >= this.maxUsers) throw new HttpError(503, "BUSY", "Research is busy. Try again shortly.", 60);
      entry = { count: 0, resetAt: now + config.rateLimitWindowMs };
      this.users.set(userId, entry);
    }
    if (entry.count >= config.rateLimitRequests) throw new HttpError(429, "RATE_LIMITED", "Too many requests. Try again shortly.", Math.max(1, Math.ceil((entry.resetAt - now) / 1000)));
    entry.count += 1;
    const date = new Date(now);
    const month = date.toISOString().slice(0, 7);
    if (this.usage.month !== month) this.usage = { month, requests: 0 };
    const usage = this.usage;
    if (usage.requests >= config.monthlyRequestCap) {
      const reset = Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1);
      throw new HttpError(429, "ALLOWANCE_EXHAUSTED", "This month’s research allowance has been reached.", Math.max(1, Math.ceil((reset - now) / 1000)));
    }
    usage.requests += 1;
    let settled = false;
    return {
      commit() { settled = true; },
      release() { if (!settled) { usage.requests -= 1; settled = true; } },
    };
  }
}
