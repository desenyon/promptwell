import assert from "node:assert/strict";
import { test } from "node:test";
import { ResearchLimits } from "./limits.ts";
const config = { monthlyRequestCap: 2, rateLimitRequests: 10, rateLimitWindowMs: 1000 };

test("in-flight requests reserve allowance atomically and failed calls release it", () => {
  const limits = new ResearchLimits();
  const a = limits.reserve("a", config);
  const b = limits.reserve("b", config);
  assert.throws(() => limits.reserve("c", config), /allowance/);
  a.release();
  a.release();
  const c = limits.reserve("c", config);
  b.commit(); b.release(); c.commit();
  assert.throws(() => limits.reserve("d", config), /allowance/);
});
test("month rollover cannot charge or release a request into the new month", () => {
  let now = Date.parse("2026-01-31T23:59:59Z");
  const limits = new ResearchLimits(() => now);
  const old = limits.reserve("a", { ...config, monthlyRequestCap: 1 });
  now += 2000;
  const next = limits.reserve("b", { ...config, monthlyRequestCap: 1 });
  old.release(); next.commit();
  assert.throws(() => limits.reserve("c", { ...config, monthlyRequestCap: 1 }), /allowance/);
});
test("rate limit supplies retry timing and expires", () => {
  let now = 0;
  const limits = new ResearchLimits(() => now);
  const restricted = { ...config, rateLimitRequests: 1 };
  limits.reserve("a", restricted).release();
  assert.throws(() => limits.reserve("a", restricted), (error: unknown) => {
    assert.equal((error as { retryAfter: number }).retryAfter, 1); return true;
  });
  now = 1000;
  limits.reserve("a", restricted).release();
});
test("limiter fails closed at its memory bound and cleans expired users", () => {
  let now = 0;
  const limits = new ResearchLimits(() => now, 1);
  limits.reserve("a", config).release();
  assert.throws(() => limits.reserve("b", config), /busy/);
  now = 1001;
  limits.reserve("b", config).release();
});
