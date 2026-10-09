import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import postgres from "postgres";
import { profile, session } from "../src/lib/research/fixtures.test-support.ts";
import { HttpError } from "../src/lib/http.ts";

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error("TEST_DATABASE_URL must point to a disposable PostgreSQL database.");
process.env.DATABASE_URL = url;
const db = await import(process.env.TEST_DB_MODULE || "../src/lib/db.ts");
const sql = postgres(url, { max: 1, onnotice: () => {} });
const owner = `test-${randomUUID()}`;
const other = `test-${randomUUID()}`;

test("PostgreSQL migration, durable progress and owner isolation", async (t) => {
  const schema = await readFile(new URL("../db/schema.sql", import.meta.url), "utf8");
  try {
    const existing = await sql`SELECT 1 FROM information_schema.tables WHERE table_schema = 'promptwell' LIMIT 1`;
    assert.equal(existing.length, 0, "Use a fresh disposable database; the test does not drop existing tables.");
    // Apply the pre-upgrade schema, insert historical data, then migrate twice.
    const oldSchema = schema.split("-- Additive, idempotent migration")[0];
    await sql.unsafe(oldSchema);
    await sql`INSERT INTO promptwell.profiles (user_id, email) VALUES (${owner}, 'test@example.com'), (${other}, 'other@example.com')`;
    await sql`INSERT INTO promptwell.workspaces (id, user_id, name)
      VALUES (${owner + ":default"}, ${owner}, 'Personal'), (${other + ":default"}, ${other}, 'Personal')`;
    const legacyId = randomUUID();
    await sql`INSERT INTO promptwell.sessions (id, user_id, workspace_id, title, prompt, stage)
      VALUES (${legacyId}, ${owner}, ${owner + ":default"}, 'Legacy', 'Legacy request', 'questions')`;
    const account = { ...profile, workspace: { ...profile.workspace, id: owner + ":default" } };
    const pending = (error: unknown) => error instanceof HttpError && error.status === 503 && error.code === "SCHEMA_MIGRATION_REQUIRED";
    await t.test("the old schema pauses storage operations before any existing data changes", async () => {
      const before = await sql`SELECT row_to_json(p) AS data FROM promptwell.profiles p ORDER BY user_id`;
      await assert.rejects(db.getOrCreateProfile(owner, "changed@example.com"), pending);
      await assert.rejects(db.saveProfile(owner, "changed@example.com", account), pending);
      await assert.rejects(db.listSessions(owner, account.workspace.id), pending);
      await assert.rejects(db.upsertSession(owner, { ...session, id: legacyId, workspaceId: account.workspace.id }), pending);
      await assert.rejects(db.deleteSession(owner, legacyId), pending);
      assert.deepEqual(await sql`SELECT row_to_json(p) AS data FROM promptwell.profiles p ORDER BY user_id`, before);
      const [unchanged] = await sql`SELECT title, prompt, stage FROM promptwell.sessions WHERE id = ${legacyId}`;
      assert.deepEqual(unchanged, { title: "Legacy", prompt: "Legacy request", stage: "questions" });
    });
    await t.test("a partial progress migration stays unavailable", async () => {
      await sql`ALTER TABLE promptwell.sessions ADD COLUMN quality_round integer NOT NULL DEFAULT 4 CHECK (quality_round BETWEEN 1 AND 4)`;
      await assert.rejects(db.listSessions(owner, account.workspace.id), pending);
      await assert.rejects(db.getOrCreateProfile(owner, "test@example.com"), pending);
    });
    await sql.unsafe(schema);
    await sql.unsafe(schema);
    await t.test("the same running process recovers immediately after migration", async () => {
      assert.equal((await db.getOrCreateProfile(owner, "test@example.com")).workspace.id, account.workspace.id);
      assert.equal((await db.saveProfile(owner, "test@example.com", account)).onboardingCompleted, true);
      assert.equal((await db.listSessions(owner, account.workspace.id))[0].id, legacyId);
    });
    await t.test("legacy sessions migrate without resetting the research allowance", async () => {
      const [legacy] = await sql`SELECT quality_round, question_index FROM promptwell.sessions WHERE id = ${legacyId}`;
      assert.equal(legacy.quality_round, 4);
      assert.equal(legacy.question_index, 0);
    });
    const current = { ...session, id: randomUUID(), workspaceId: `${owner}:default`, qualityRound: 2, questionIndex: 1,
      questions: [...session.questions, { ...session.questions[0], id: "second" }],
      updatedAt: "2099-01-01T00:00:00.000Z", createdAt: "2099-01-01T00:00:00.000Z" };
    await t.test("saves progress with authoritative timestamps", async () => {
      const saved = await db.upsertSession(owner, current);
      assert.equal(saved.qualityRound, 2); assert.equal(saved.questionIndex, 1);
      assert.ok(Date.parse(saved.createdAt) <= Date.now());
      assert.ok(Date.parse(saved.updatedAt) <= Date.now());
      const loaded = (await db.listSessions(owner, current.workspaceId)).find((s: { id: string }) => s.id === current.id);
      assert.equal(loaded.qualityRound, 2); assert.equal(loaded.questionIndex, 1);
    });
    await t.test("old clients preserve progress and stale rounds cannot lower the budget", async () => {
      const oldClient = { ...current, qualityRound: undefined, questionIndex: undefined };
      const saved = await db.upsertSession(owner, oldClient);
      assert.equal(saved.qualityRound, 2); assert.equal(saved.questionIndex, 1);
      assert.equal((await db.upsertSession(owner, { ...current, qualityRound: 1 })).qualityRound, 2);
    });
    await t.test("another user cannot read, overwrite or delete the session", async () => {
      assert.deepEqual(await db.listSessions(other, current.workspaceId), []);
      await assert.rejects(db.upsertSession(other, { ...current, workspaceId: `${other}:default` }));
      await assert.rejects(db.upsertSession(other, { ...current, id: randomUUID() }));
      assert.equal(await db.deleteSession(other, current.id), false);
      assert.equal(await db.deleteSession(owner, current.id), true);
    });
  } finally {
    await sql`DELETE FROM promptwell.profiles WHERE user_id IN (${owner}, ${other})`;
    await sql.end();
    const state = globalThis as typeof globalThis & { promptwellDatabase?: ReturnType<typeof postgres> };
    await state.promptwellDatabase?.end();
  }
});
