import assert from "node:assert/strict";
import { test } from "node:test";
import { getSessionProgress, SessionWriter, mergeResearch } from "./sessionState.ts";
import { result, session } from "./lib/research/fixtures.test-support.ts";

test("legacy history resumes conservatively without a new round budget", () => {
  assert.deepEqual(getSessionProgress(session), { qualityRound: 4, questionIndex: 0 });
  assert.deepEqual(getSessionProgress({ ...session, qualityRound: 2, questionIndex: 0 }), { qualityRound: 2, questionIndex: 0 });
});
test("skipped question position survives save/load", () => {
  const saved = { ...session, questions: [...session.questions, { ...session.questions[0], id: "two" }], qualityRound: 3, questionIndex: 1 };
  assert.equal(getSessionProgress(saved).questionIndex, 1);
});
test("saves are serialized, a failed save cannot block newer progress", async () => {
  let release!: () => void;
  const writes: string[] = [];
  const writer = new SessionWriter(async (value) => {
    writes.push(value.title);
    if (value.title === "first") { await new Promise<void>((resolve) => { release = resolve; }); throw new Error("offline"); }
    return value;
  });
  const first = writer.save({ ...session, title: "first" });
  const rejected = assert.rejects(first, /offline/);
  const second = writer.save({ ...session, title: "second" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(writes, ["first"]);
  release(); await rejected;
  assert.equal((await second).title, "second");
  await writer.drain(session.id);
  assert.deepEqual(writes, ["first", "second"]);
});
test("research merge retains fresh guidance when the existing brief is full", () => {
  const current = { ...result, researchBrief: { ...result.researchBrief, toolPlan: Array.from({ length: 8 }, (_, i) => `old ${i}`) } };
  const followUp = { ...result, questions: [{ ...result.questions[0], id: "new" }], researchBrief: { ...result.researchBrief, toolPlan: ["new acceptance check"] } };
  const merged = mergeResearch(current, followUp);
  assert.equal(merged.questions.length, 2);
  assert.ok(merged.researchBrief.toolPlan.includes("new acceptance check"));
  assert.equal(merged.sources.length, 1);
  assert.throws(() => mergeResearch(current, result), /new questions/);
});
