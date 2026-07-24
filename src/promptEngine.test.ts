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
