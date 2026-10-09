import assert from "node:assert/strict";
import { test } from "node:test";
import { parseResearchResult, parseResearchRequest, parseSession, readJsonBody } from "./validation.ts";
import { result, session } from "./research/fixtures.test-support.ts";

test("valid research is preserved and unknown fields are stripped", () => {
  assert.deepEqual(parseResearchResult({ ...result, surprise: "ignored" }), result);
});
for (const [name, change] of Object.entries({
  "duplicate question ids": { questions: [result.questions[0], result.questions[0]] },
  "empty choice options": { questions: [{ ...result.questions[0], kind: "choice", options: [] }] },
  "invalid option values": { questions: [{ ...result.questions[0], options: [12] }] },
  "blank question": { questions: [{ ...result.questions[0], prompt: " " }] },
  "unsafe source URL": { sources: [{ ...result.sources[0], url: "javascript:alert(1)" }] },
  "credential-bearing URL": { sources: [{ ...result.sources[0], url: "https://user:pass@example.com" }] },
  "invalid practice": { researchBrief: { ...result.researchBrief, practices: [null] } },
  "oversized list": { questions: Array.from({length: 9}, (_, i) => ({ ...result.questions[0], id: String(i) })) },
})) {
  test(`rejects ${name}`, () => assert.throws(() => parseResearchResult({ ...result, ...change })));
}
test("empty sources require explicit permission", () => {
  assert.throws(() => parseResearchResult({ ...result, sources: [] }));
  assert.deepEqual(parseResearchResult({ ...result, sources: [] }, { allowEmptySources: true }).sources, []);
});
test("initial request rejects unknown mode and out-of-bounds prompt", () => {
  assert.deepEqual(parseResearchRequest({ prompt: "  Build a settings page.  " }, 12000), { prompt: "Build a settings page.", mode: "initial", iteration: null });
  assert.throws(() => parseResearchRequest({ prompt: "too short" }, 12000));
  assert.throws(() => parseResearchRequest({ prompt: "Build a settings page.", mode: "bad" }, 12000));
  assert.throws(() => parseResearchRequest({ prompt: "Build a settings page.", mode: "iterate", iteration: { round: 5 } }, 12000));
});
test("session validation enforces ownership, nested structure and progress", () => {
  assert.equal(parseSession(session, "user").id, session.id);
  assert.throws(() => parseSession(session, "other"));
  assert.throws(() => parseSession({ ...session, answers: [{ questionId: "unknown", value: "answer" }] }, "user"));
  assert.throws(() => parseSession({ ...session, qualityRound: 0 }, "user"));
  assert.throws(() => parseSession({ ...session, questionIndex: 1 }, "user"));
  assert.equal(parseSession({ ...session, qualityRound: 4, questionIndex: 0 }, "user").qualityRound, 4);
});
test("bounded JSON reader checks bytes, even with no Content-Length", async () => {
  await assert.rejects(readJsonBody(new Request("http://localhost", { method: "POST", body: '"ééé"' }), 7), /too large/);
  await assert.rejects(readJsonBody(new Request("http://localhost", { method: "POST", body: "bad" }), 100), /valid JSON/);
  assert.deepEqual(await readJsonBody(new Request("http://localhost", { method: "POST", body: '{"ok":true}' }), 100), { ok: true });
});

test("a full-length interview can persist its compiled output", async () => {
  const { compilePrompt } = await import("../promptEngine.ts");
  const { profile } = await import("./research/fixtures.test-support.ts");
  const questions = Array.from({ length: 23 }, (_, index) => ({ ...result.questions[0], id: `q${index}`, why: "Relevant context. ".repeat(30) }));
  const answers = questions.map((q) => ({ questionId: q.id, value: "Concrete answer. ".repeat(235) }));
  const compiledPrompt = compilePrompt(session.prompt, questions, answers, profile, result.researchBrief, result.sources);
  assert.ok(compiledPrompt.length > 100000);
  const saved = parseSession({ ...session, questions, answers, compiledPrompt, qualityRound: 4, questionIndex: 22 }, "user");
  assert.equal(saved.compiledPrompt, compiledPrompt);
});
