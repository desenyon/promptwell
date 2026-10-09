import type { SavedPrompt, UserProfile } from "../../types.ts";

export const profile: UserProfile = {
  onboardingCompleted: true, platforms: ["codex"], tools: ["context7"], instructionFiles: ["agents-md"],
  preferences: { detailLevel: "focused", researchByDefault: true, includeToolPlan: true, askOnlyMissing: true, customInstructions: "" },
  workspace: { id: "user:default", name: "Personal", overrides: { platforms: [], tools: [], instructionFiles: [] } },
};
export const result = {
  questions: [{ id: "scope", principle: "Scope", prompt: "What should change?", why: "Bounds the result.", kind: "text" as const, options: [], placeholder: "Scope" }],
  sources: [{ title: "Docs", url: "https://example.com/docs", practice: "Verify the API." }],
  researchBrief: { domain: "engineering", taskType: "implementation", practices: [{ title: "Test", guidance: "Test changes", application: "Check the save path" }], toolPlan: ["Inspect local instructions"], verificationPlan: ["Check the result"] },
};
export const session: SavedPrompt = {
  id: "session-1", workspaceId: "user:default", title: "Settings", prompt: "Build a settings page.",
  ...result, answers: [], compiledPrompt: "Compiled result", stage: "questions",
  createdAt: "2026-10-09T00:00:00.000Z", updatedAt: "2026-10-09T00:00:00.000Z",
};
