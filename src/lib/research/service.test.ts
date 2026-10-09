import assert from "node:assert/strict";
import { test } from "node:test";
import { handleResearch } from "./service.ts";
import { readEngineConfig } from "./config.ts";
import { ResearchLimits } from "./limits.ts";
import { profile, result } from "./fixtures.test-support.ts";

const config = readEngineConfig({ OPENAI_API_KEY: "test-key" });
const user = { id: "user", email: "test@example.com" };
const request = (body: unknown = { prompt: "Build a settings page." }, signal?: AbortSignal) => new Request("http://localhost/api/refine", { method: "POST", body: JSON.stringify(body), signal });
const success = (value: unknown = result) => Response.json({ status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(value) }] }] });
function dependencies(fetcher: typeof fetch = async () => success()) {
  return { config: () => config, loadProfile: async () => profile, fetch: fetcher, limits: new ResearchLimits(), log: () => {} };
}
test("anonymous and invalid requests cannot call the provider", async () => {
  const deps = dependencies(async () => { throw new Error("must not call"); });
  assert.equal((await handleResearch(request(), null, deps)).status, 401);
  assert.equal((await handleResearch(request({ prompt: "bad" }), user, deps)).status, 400);
  assert.equal((await handleResearch(request({ prompt: "x".repeat(300000) }), user, deps)).status, 413);
});
test("profile and configuration failures return actionable non-secret responses", async () => {
  const deps = dependencies();
  assert.equal((await handleResearch(request(), user, { ...deps, config: () => { throw new Error("secret"); } })).status, 503);
  assert.equal((await handleResearch(request(), user, { ...deps, loadProfile: async () => { throw new Error("secret"); } })).status, 503);
  assert.equal((await handleResearch(request(), user, { ...deps, loadProfile: async () => ({ ...profile, onboardingCompleted: false }) })).status, 409);
});
test("successful research is validated and receives no-store headers", async () => {
  const response = await handleResearch(request(), user, dependencies());
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), result);
});
test("disabled research never offers web tools or accepts invented citations", async () => {
  const deps = dependencies(async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    assert.deepEqual(body.tools, []);
    assert.equal(body.tool_choice, "none");
    assert.equal(body.store, false);
    assert.match(body.instructions, /Do not browse/);
    return success(result);
  });
  deps.loadProfile = async () => ({ ...profile, preferences: { ...profile.preferences, researchByDefault: false } });
  const response = await handleResearch(request(), user, deps);
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).sources, []);
});
for (const [name, fetcher] of Object.entries({
  "network failure": async () => { throw new TypeError("network secret"); },
  "upstream rejection": async () => new Response("secret", { status: 429 }),
  "invalid envelope JSON": async () => new Response("not json"),
  "incomplete output": async () => Response.json({ status: "incomplete", output: [] }),
  "malformed nested data": async () => success({ ...result, questions: [{ id: "broken" }] }),
  "provider refusal": async () => Response.json({ status: "completed", output: [{ type: "message", content: [{ type: "refusal", refusal: "no" }] }] }),
})) {
  test(`${name} is bounded and releases the allowance`, async () => {
    const deps = dependencies(fetcher as typeof fetch);
    deps.config = () => ({ ...config, monthlyRequestCap: 1 });
    const response = await handleResearch(request(), user, deps);
    assert.equal(response.status, 502);
    assert.doesNotMatch(await response.text(), /secret/);
    deps.fetch = async () => success();
    assert.equal((await handleResearch(request(), user, deps)).status, 200);
    const limited = await handleResearch(request(), user, deps);
    assert.equal(limited.status, 429);
    assert.ok(Number(limited.headers.get("retry-after")) > 0);
  });
}
test("provider timeout returns 504 and aborts the fetch", async () => {
  const deps = dependencies((_url, init) => new Promise((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
  }));
  deps.config = () => ({ ...config, timeoutMs: 10 });
  assert.equal((await handleResearch(request(), user, deps)).status, 504);
});
test("cancelled client does not begin a provider request", async () => {
  const controller = new AbortController(); controller.abort();
  const deps = dependencies(async () => { assert.fail("provider must not run"); });
  assert.equal((await handleResearch(request(undefined, controller.signal), user, deps)).status, 499);
});
test("configuration rejects partial integers and out-of-range limits", () => {
  for (const value of ["10junk", "1.5", "0", "-1", "99999999999999999"]) {
    assert.throws(() => readEngineConfig({ OPENAI_API_KEY: "key", PROMPT_RATE_LIMIT_REQUESTS: value }));
  }
  assert.throws(() => readEngineConfig({ OPENAI_API_KEY: "key", PROMPT_MAX_CHARACTERS: "12001" }));
  assert.equal(config.timeoutMs, 60000);
});

test("exhausted rate limits reject before touching account storage", async () => {
  const deps = dependencies();
  deps.config = () => ({ ...config, rateLimitRequests: 1 });
  let reads = 0;
  deps.loadProfile = async () => { reads++; return profile; };
  assert.equal((await handleResearch(request(), user, deps)).status, 200);
  assert.equal((await handleResearch(request(), user, deps)).status, 429);
  assert.equal(reads, 1);
});
