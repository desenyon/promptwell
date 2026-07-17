import type {
  Answer,
  PromptScore,
  Question,
  ResearchBrief,
  ResearchSource,
} from "./types";

function validateQuestions(value: unknown): Question[] {
  if (!value || typeof value !== "object" || !("questions" in value)) {
    throw new Error("Prompt research returned an invalid question set.");
  }

  const rawQuestions = (value as { questions: unknown }).questions;
  if (!Array.isArray(rawQuestions)) {
    throw new Error("Prompt research did not include questions.");
  }

  const questions = rawQuestions.filter((item): item is Question => {
    if (!item || typeof item !== "object") return false;
    const candidate = item as Partial<Question>;
    return (
      typeof candidate.id === "string" &&
      typeof candidate.principle === "string" &&
      typeof candidate.prompt === "string" &&
      typeof candidate.why === "string" &&
      (candidate.kind === "choice" || candidate.kind === "text")
    );
  });

  if (questions.length === 0) {
    throw new Error("Prompt research returned no usable questions.");
  }

  return questions.slice(0, 8);
}

export interface RefineResponse {
  questions: Question[];
  sources: ResearchSource[];
  researchBrief: ResearchBrief;
}

export interface IterateRequest {
  answers: Answer[];
  questions: Question[];
  score: PromptScore;
  overall: number;
  weakDimensions: string[];
  researchBrief: ResearchBrief;
  round: number;
}

function validateSources(value: unknown, allowEmpty = false): ResearchSource[] {
  if (!Array.isArray(value)) {
    throw new Error("Prompt research did not include sources.");
  }

  const sources = value.filter((item): item is ResearchSource => {
    if (!item || typeof item !== "object") return false;
    const candidate = item as Partial<ResearchSource>;
    if (
      typeof candidate.title !== "string" ||
      typeof candidate.url !== "string" ||
      typeof candidate.practice !== "string"
    ) {
      return false;
    }

    try {
      return new URL(candidate.url).protocol === "https:";
    } catch {
      return false;
    }
  });

  if (!allowEmpty && sources.length === 0) {
    throw new Error("Prompt research returned no valid sources.");
  }
  return sources.slice(0, 6);
}

function validateStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw new Error(`Prompt research returned an invalid ${field}.`);
  }
  return value.slice(0, 8);
}

function validateResearchBrief(value: unknown): ResearchBrief {
  if (!value || typeof value !== "object") {
    throw new Error("Prompt research did not include a strategy.");
  }
  const candidate = value as Partial<ResearchBrief>;
  if (
    typeof candidate.domain !== "string" ||
    typeof candidate.taskType !== "string" ||
    !Array.isArray(candidate.practices)
  ) {
    throw new Error("Prompt research returned an invalid strategy.");
  }

  const practices = candidate.practices.filter(
    (practice) =>
      practice &&
      typeof practice === "object" &&
      typeof practice.title === "string" &&
      typeof practice.guidance === "string" &&
      typeof practice.application === "string",
  );
  if (practices.length === 0) {
    throw new Error("Prompt research returned no usable practices.");
  }

  return {
    domain: candidate.domain,
    taskType: candidate.taskType,
    practices: practices.slice(0, 6),
    toolPlan: validateStringArray(candidate.toolPlan, "tool plan"),
    verificationPlan: validateStringArray(candidate.verificationPlan, "verification plan"),
  };
}

async function requestRefine(
  prompt: string,
  payload: Record<string, unknown> = {},
  allowEmptySources = false,
): Promise<RefineResponse> {
  const response = await fetch("/api/refine", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ prompt, ...payload }),
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? "Prompt research failed.");
  }

  const body = (await response.json()) as {
    questions?: unknown;
    sources?: ResearchSource[];
    researchBrief?: unknown;
  };

  return {
    questions: validateQuestions({ questions: body.questions }),
    sources: validateSources(body.sources, allowEmptySources),
    researchBrief: validateResearchBrief(body.researchBrief),
  };
}

export async function generateQuestions(prompt: string): Promise<RefineResponse> {
  return requestRefine(prompt);
}

export async function generateFollowUpQuestions(
  prompt: string,
  iteration: IterateRequest,
): Promise<RefineResponse> {
  return requestRefine(
    prompt,
    {
      mode: "iterate",
      iteration: {
        round: iteration.round,
        overall: iteration.overall,
        score: iteration.score,
        weakDimensions: iteration.weakDimensions,
        priorQuestionIds: iteration.questions.map((question) => question.id),
        answeredDecisions: iteration.questions
          .map((question) => {
            const answer = iteration.answers.find((item) => item.questionId === question.id);
            if (!answer?.value.trim()) return null;
            return {
              id: question.id,
              principle: question.principle,
              question: question.prompt,
              answer: answer.value.trim(),
            };
          })
          .filter(Boolean),
        researchBrief: iteration.researchBrief,
        qualityGate: 85,
      },
    },
    true,
  );
}
