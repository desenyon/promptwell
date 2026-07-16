import type { Question, ResearchSource } from "./types";

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

  return questions.slice(0, 7);
}

interface RefineResponse {
  questions: Question[];
  sources: ResearchSource[];
}

export async function generateQuestions(prompt: string): Promise<RefineResponse> {
  const response = await fetch("/api/refine", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ prompt }),
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? "Prompt research failed.");
  }

  const body = (await response.json()) as {
    questions?: unknown;
    sources?: ResearchSource[];
  };

  return {
    questions: validateQuestions({ questions: body.questions }),
    sources: Array.isArray(body.sources) ? body.sources : [],
  };
}
