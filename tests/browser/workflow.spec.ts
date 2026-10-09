import { test, expect, type Page } from "@playwright/test";
import { profile, result, session } from "../../src/lib/research/fixtures.test-support";
import type { SavedPrompt } from "../../src/types";

async function account(page: Page, initial: SavedPrompt[] = [], failSaves = false) {
  const state = { sessions: initial, failSaves, saves: [] as SavedPrompt[] };
  await page.route("**/api/profile", (route) => route.fulfill({ json: { profile } }));
  await page.route("**/api/sessions**", async (route) => {
    if (route.request().method() === "PUT") {
      const saved = route.request().postDataJSON().session as SavedPrompt;
      state.saves.push(saved);
      if (state.failSaves) { await route.fulfill({ status: 503, json: { error: "Offline" } }); return; }
      state.sessions = [saved, ...state.sessions.filter((s) => s.id !== saved.id)];
      await route.fulfill({ json: { session: saved } }); return;
    }
    await route.fulfill({ json: { sessions: state.sessions } });
  });
  return state;
}
async function openHistory(page: Page) {
  await page.getByRole("button", { name: /^History/ }).click();
  await page.locator(".history-open").first().click();
}

test("skipped question cursor and research round survive a reload", async ({ page }) => {
  const saved = { ...session, qualityRound: 3, questionIndex: 0, questions: [...result.questions, { ...result.questions[0], id: "second", prompt: "Second decision?" }] };
  const state = await account(page, [saved]);
  await page.goto("/"); await openHistory(page);
  await expect(page.getByText(/Adaptive interview.*round 3/)).toBeVisible();
  await page.getByRole("button", { name: "Memory already covers this" }).click();
  await expect.poll(() => state.sessions[0].questionIndex).toBe(1);
  await page.reload(); await openHistory(page);
  await expect(page.getByRole("heading", { name: "Second decision?" })).toBeVisible();
  await expect(page.getByText(/Adaptive interview.*round 3/)).toBeVisible();
});

test("resuming round four never starts a fifth research request", async ({ page }) => {
  await account(page, [{ ...session, qualityRound: 4, questionIndex: 0 }]);
  let calls = 0;
  await page.route("**/api/refine", (route) => { calls++; return route.fulfill({ json: result }); });
  await page.goto("/"); await openHistory(page);
  await page.getByRole("button", { name: "Memory already covers this" }).click();
  await expect(page.getByRole("button", { name: "Copy prompt" })).toBeVisible();
  expect(calls).toBe(0);
});

test("reset during research ignores the abandoned response", async ({ page }) => {
  const state = await account(page);
  let finish!: () => void;
  const blocked = new Promise<void>((resolve) => { finish = resolve; });
  await page.route("**/api/refine", async (route) => { await blocked; await route.fulfill({ json: result }).catch(() => {}); });
  await page.goto("/");
  await page.getByLabel("Your rough prompt").fill("Build a settings page.");
  const started = page.waitForRequest("**/api/refine");
  await page.getByRole("button", { name: "Research prompt" }).click(); await started;
  await page.getByRole("button", { name: /New prompt/ }).click();
  finish();
  await expect(page.getByLabel("Your rough prompt")).toBeVisible();
  await expect(page.getByLabel("Your rough prompt")).toHaveValue("");
  expect(state.saves).toHaveLength(0);
});

test("failed sync can retry the most recent answers", async ({ page }) => {
  const state = await account(page, [{ ...session, qualityRound: 4, questionIndex: 0 }], true);
  await page.goto("/"); await openHistory(page);
  await page.getByRole("textbox").fill("Only change the account settings form.");
  await page.getByRole("button", { name: "Save answer" }).click();
  await expect(page.getByRole("button", { name: "Retry sync" })).toBeVisible();
  state.failSaves = false;
  await page.getByRole("button", { name: "Retry sync" }).click();
  await expect(page.getByText("Synced", { exact: true })).toBeVisible();
  expect(state.sessions[0].answers[0].value).toBe("Only change the account settings form.");
});

test("research, follow-up, manual completion and Markdown export work together", async ({ page }) => {
  const state = await account(page);
  const rounds: number[] = [];
  await page.route("**/api/refine", (route) => {
    const input = route.request().postDataJSON();
    rounds.push(input.iteration?.round ?? 1);
    return route.fulfill({ json: input.mode === "iterate" ? {
      ...result, questions: [{ ...result.questions[0], id: "verify", prompt: "How will you verify the change?" }],
    } : result });
  });
  await page.goto("/");
  await page.getByLabel("Your rough prompt").fill("Build a settings page.");
  await page.getByRole("button", { name: "Research prompt" }).click();
  await page.getByRole("textbox").fill("Only change the settings form.");
  await page.getByRole("button", { name: "Save answer" }).click();
  await expect(page.getByRole("heading", { name: "How will you verify the change?" })).toBeVisible();
  await expect(page.getByText(/Adaptive interview.*round 2/)).toBeVisible();
  await page.getByRole("textbox").fill("Verify saved preferences after reload.");
  await page.getByRole("button", { name: "Use current prompt" }).click();
  await expect(page.getByText("Synced", { exact: true })).toBeVisible();
  expect(rounds).toEqual([1, 2]);
  expect(state.sessions[0].answers).toHaveLength(2);
  expect(state.sessions[0].qualityRound).toBe(2);
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download Markdown" }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toBe("promptwell-prompt.md");
  const { readFile } = await import("node:fs/promises");
  const exported = await readFile((await download.path())!, "utf8");
  expect(exported).toContain("https://example.com/docs");
  expect(exported).toContain("Verify saved preferences after reload.");
  await page.reload(); await openHistory(page);
  await expect(page.getByRole("button", { name: "Copy prompt" })).toBeVisible();
  await expect(page.locator(".compiled-prompt")).toContainText("Verify saved preferences after reload.");
});

test("a failed delete remains visible with an actionable error", async ({ page }) => {
  await account(page, [{ ...session, qualityRound: 4, questionIndex: 0 }]);
  await page.route("**/api/sessions?id=*", (route) => route.fulfill({ status: 503, json: { error: "Prompt could not be deleted." } }));
  await page.goto("/");
  await page.getByRole("button", { name: /^History/ }).click();
  page.on("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Delete Settings" }).click();
  await expect(page.getByRole("alert")).toContainText("could not be deleted");
  await expect(page.locator(".history-open")).toHaveCount(1);
});

test("disabled web research is labeled honestly and can be cancelled", async ({ page }) => {
  await account(page);
  await page.route("**/api/profile", (route) => route.fulfill({ json: {
    profile: { ...profile, preferences: { ...profile.preferences, researchByDefault: false } },
  } }));
  let finish!: () => void;
  const blocked = new Promise<void>((resolve) => { finish = resolve; });
  await page.route("**/api/refine", async (route) => { await blocked; await route.fulfill({ json: { ...result, sources: [] } }).catch(() => {}); });
  await page.goto("/");
  await page.getByLabel("Your rough prompt").fill("Build a settings page.");
  await page.getByRole("button", { name: "Research prompt" }).click();
  await expect(page.getByText("Preparing prompt", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Cancel research" }).click();
  finish();
  await expect(page.getByLabel("Your rough prompt")).toHaveValue("Build a settings page.");
});

test("a delayed delete cannot reset another prompt opened meanwhile", async ({ page }) => {
  const another = { ...session, id: "another", title: "Another prompt", prompt: "Build another settings page.", qualityRound: 4, questionIndex: 0,
    questions: [{ ...session.questions[0], prompt: "Another decision?" }] };
  await account(page, [{ ...session, qualityRound: 4, questionIndex: 0 }, another]);
  let finish!: () => void;
  const blocked = new Promise<void>((resolve) => { finish = resolve; });
  await page.route("**/api/sessions?id=session-1", async (route) => { await blocked; await route.fulfill({ status: 204 }); });
  await page.goto("/"); await openHistory(page);
  await page.getByRole("button", { name: /^History/ }).click();
  page.on("dialog", (dialog) => dialog.accept());
  const started = page.waitForRequest("**/api/sessions?id=session-1");
  await page.getByRole("button", { name: "Delete Settings" }).click(); await started;
  await page.locator(".history-open").filter({ hasText: "Another prompt" }).click();
  const finished = page.waitForResponse("**/api/sessions?id=session-1");
  finish(); await finished;
  await expect(page.getByRole("heading", { name: "Another decision?" })).toBeVisible();
});
