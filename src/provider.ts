import { parseResearchResult } from "./lib/validation.ts";
import type { Answer, PromptScore, Question, ResearchBrief, ResearchSource } from "./types.ts";

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

async function requestRefine(
  prompt: string,
  payload: Record<string, unknown> = {},
  signal?: AbortSignal,
): Promise<RefineResponse> {
  const response = await fetch("/api/refine", {
    method: "POST",
    signal,
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ prompt, ...payload }),
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? "Prompt research failed.");
  }

  return parseResearchResult(await response.json(), { allowEmptySources: true });
}

export async function generateQuestions(prompt: string, signal?: AbortSignal): Promise<RefineResponse> {
  return requestRefine(prompt, {}, signal);
}

export async function generateFollowUpQuestions(
  prompt: string,
  iteration: IterateRequest,
  signal?: AbortSignal,
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
    signal,
  );
}
