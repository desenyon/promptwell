import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  MAX_QUALITY_ROUNDS,
  QUALITY_GATE,
  compilePrompt,
  overallScore,
  scoreSpecification,
  weakDimensions,
} from "./promptEngine.ts";
import type { Answer, Question, ResearchBrief, UserProfile } from "./types.ts";

const baseBrief: ResearchBrief = {
  domain: "web engineering",
  taskType: "settings page implementation",
  practices: [
    {
      title: "Prefer local verification",
      guidance: "Run focused checks before broad suites.",
      application: "Verify form validation and save paths first.",
    },
  ],
  toolPlan: ["Inspect current settings routes before editing."],
  verificationPlan: ["Pass: profile save succeeds with valid input."],
};

const baseQuestions: Question[] = [
  {
    id: "artifact",
    principle: "Artifact / outcome",
    prompt: "What exact UI artifact should ship?",
    why: "Locks the deliverable.",
    kind: "text",
  },
  {
    id: "constraints",
    principle: "Constraints / scope",
    prompt: "What must never change?",
    why: "Protects unrelated flows.",
    kind: "text",
  },
  {
    id: "verification",
    principle: "Verification / acceptance criteria",
    prompt: "What is the pass/fail checklist?",
    why: "Makes done measurable.",
    kind: "text",
  },
];

const concreteAnswers: Answer[] = [
  {
    questionId: "artifact",
    value:
      "Ship a Next.js account settings page with profile fields and notification toggles at /settings.",
  },
  {
    questionId: "constraints",
    value:
      "Must never alter auth cookies; only update profile and notification preferences under 1200ms p95.",
  },
  {
    questionId: "verification",
    value:
      "Pass if save persists preferences and fail if validation allows empty email. Checklist: unit + one browser path.",
  },
];

const profile: UserProfile = {
  onboardingCompleted: true,
  platforms: ["cursor"],
  tools: ["web-search", "context7"],
  instructionFiles: ["agents-md"],
  preferences: {
    detailLevel: "thorough",
    researchByDefault: true,
    includeToolPlan: true,
    askOnlyMissing: true,
    customInstructions: "",
  },
  workspace: {
    id: "user:default",
    name: "Personal workspace",
    overrides: {
      platforms: [],
      tools: [],
      instructionFiles: [],
    },
  },
};

describe("quality gate helpers", () => {
  it("exposes a stable gate and round budget", () => {
    assert.equal(QUALITY_GATE, 85);
    assert.equal(MAX_QUALITY_ROUNDS, 4);
  });

  it("scores sparse prompts below the quality gate", () => {
    const score = scoreSpecification("make it better", [], [], {
      domain: "",
      taskType: "",
      practices: [],
      toolPlan: [],
      verificationPlan: [],
    });
    assert.ok(overallScore(score) < QUALITY_GATE);
    assert.ok(weakDimensions(score).length > 0);
  });

  it("raises overall score when concrete decisions and research are present", () => {
    const sparse = overallScore(
      scoreSpecification("Build an account settings page for our Next.js app.", [], [], {
        domain: "",
        taskType: "",
        practices: [],
        toolPlan: [],
        verificationPlan: [],
      }),
    );
    const rich = overallScore(
      scoreSpecification(
        "Build an account settings page for our Next.js app with profile and notification preferences.",
        concreteAnswers,
        baseQuestions,
        baseBrief,
      ),
    );

    assert.ok(rich > sparse);
    assert.ok(rich >= 70);
  });

  it("identifies weak dimensions below the gate threshold", () => {
    const score = scoreSpecification("write a memo", [], [], {
      domain: "",
      taskType: "",
      practices: [],
      toolPlan: [],
      verificationPlan: [],
    });
    const weak = weakDimensions(score, QUALITY_GATE);
    assert.ok(weak.includes("verification"));
  });

  it("compiles remembered tools and verification into the execution prompt", () => {
    const compiled = compilePrompt(
      "Build account settings.",
      baseQuestions,
      concreteAnswers,
      profile,
      baseBrief,
      [{ title: "Next.js docs", url: "https://nextjs.org/docs", practice: "Use App Router forms." }],
    );

    assert.match(compiled, /TARGET ENVIRONMENT/);
    assert.match(compiled, /cursor/);
    assert.match(compiled, /context7/);
    assert.match(compiled, /Pass: profile save succeeds with valid input\./);
    assert.match(compiled, /Next\.js docs/);
    assert.match(compiled, /Ship a Next\.js account settings page/);
  });
});

describe("honest compiled output", () => {
  it("keeps source URLs alongside their extracted practices", () => {
    const result = compilePrompt("Build settings.", [], [], profile, baseBrief, [
      { title: "Next docs", url: "https://nextjs.org/docs", practice: "Use forms." },
    ]);
    assert.match(result, /https:\/\/nextjs.org\/docs/);
    assert.match(result, /Use forms\./);
  });

  it("omits the tool plan when the saved preference disables it", () => {
    const result = compilePrompt("Build settings.", [], [], {
      ...profile, preferences: { ...profile.preferences, includeToolPlan: false },
    }, baseBrief, []);
    assert.doesNotMatch(result, /# TOOL PLAN/);
    assert.doesNotMatch(result, /Graphify: query/);
    assert.match(result, /# VERIFICATION CONTRACT/);
  });

  it("does not award score lift for blank or repeated answers", () => {
    const prompt = "Build an account settings page for our app.";
    const expected = scoreSpecification(prompt, [concreteAnswers[0]], baseQuestions, baseBrief);
    const polluted = scoreSpecification(prompt, [
      concreteAnswers[0], concreteAnswers[0], { questionId: "empty", value: "   " },
    ], baseQuestions, baseBrief);
    assert.deepEqual(polluted, expected);
  });
});

describe("guidance provenance", () => {
  it("does not label unbrowsed guidance as researched practices", () => {
    const compiled = compilePrompt("Build settings.", [], [], {
      ...profile, preferences: { ...profile.preferences, researchByDefault: false },
    }, baseBrief, []);
    assert.doesNotMatch(compiled, /# RESEARCHED PRACTICES/);
    assert.match(compiled, /not externally verified/i);
  });
});
