import type { Answer, Question, ResearchBrief, ResearchSource, SavedPrompt } from "../types.ts";
import { MAX_QUALITY_ROUNDS } from "../promptEngine.ts";
import { HttpError } from "./http.ts";

export const MAX_PROMPT_CHARACTERS = 12_000;
export const MAX_ANSWER_CHARACTERS = 4_000;
export const MAX_SESSION_QUESTIONS = 32;

function invalid(field: string): never {
  throw new HttpError(400, "INVALID_INPUT", `Invalid ${field}.`);
}
export function object(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalid(field);
  return value as Record<string, unknown>;
}
function text(value: unknown, field: string, max: number, allowEmpty = false): string {
  if (typeof value !== "string" || value.length > max || (!allowEmpty && !value.trim())) return invalid(field);
  return value;
}
function items(value: unknown, field: string, max: number, min = 0): unknown[] {
  if (!Array.isArray(value) || value.length > max || value.length < min) return invalid(field);
  return value;
}
function strings(value: unknown, field: string, max: number, size = 2000): string[] {
  return items(value, field, max).map((item) => text(item, field, size));
}
function integer(value: unknown, field: string, min: number, max: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) return invalid(field);
  return value as number;
}
function unique(values: string[], field: string): void {
  if (new Set(values).size !== values.length) invalid(field);
}
function questions(value: unknown, max: number): Question[] {
  const result = items(value, "questions", max, 1).map((item): Question => {
    const q = object(item, "question");
    if (q.kind !== "choice" && q.kind !== "text") return invalid("question kind");
    const options = q.options === undefined ? undefined : strings(q.options, "options", 5, 1000);
    if (q.kind === "choice" && (!options || options.length < 2)) return invalid("choice options");
    if (options) unique(options, "duplicate options");
    return {
      id: text(q.id, "question id", 100), principle: text(q.principle, "principle", 300),
      prompt: text(q.prompt, "question prompt", 2000), why: text(q.why, "question rationale", 2000), kind: q.kind,
      ...(options ? { options } : {}),
      ...(q.placeholder === undefined ? {} : { placeholder: text(q.placeholder, "placeholder", 1000, true) }),
    };
  });
  unique(result.map((q) => q.id), "duplicate question ids");
  return result;
}
function sources(value: unknown, allowEmpty: boolean, max: number): ResearchSource[] {
  return items(value, "sources", max, allowEmpty ? 0 : 1).map((item) => {
    const s = object(item, "source");
    const url = text(s.url, "source URL", 2048);
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== "https:" || parsed.username || parsed.password) invalid("source URL");
    } catch { return invalid("source URL"); }
    return { title: text(s.title, "source title", 500), url,
      ...(s.practice === undefined ? {} : { practice: text(s.practice, "source practice", 2000, true) }) };
  });
}
export function parseResearchBrief(value: unknown): ResearchBrief {
  const b = object(value, "research brief");
  return {
    domain: text(b.domain, "domain", 300), taskType: text(b.taskType, "task type", 300),
    practices: items(b.practices, "practices", 6, 1).map((item) => {
      const p = object(item, "practice");
      return { title: text(p.title, "practice title", 500), guidance: text(p.guidance, "guidance", 2000), application: text(p.application, "application", 2000) };
    }),
    toolPlan: strings(b.toolPlan, "tool plan", 8), verificationPlan: strings(b.verificationPlan, "verification plan", 8),
  };
}
export function parseResearchResult(value: unknown, options: { allowEmptySources?: boolean; maxQuestions?: number; maxSources?: number } = {}) {
  const r = object(value, "research result");
  return {
    questions: questions(r.questions, options.maxQuestions ?? 8),
    sources: sources(r.sources, options.allowEmptySources ?? false, options.maxSources ?? 6),
    researchBrief: parseResearchBrief(r.researchBrief),
  };
}
export function parseResearchRequest(value: unknown, maxPromptCharacters: number) {
  const r = object(value, "request");
  const prompt = text(r.prompt, "prompt", maxPromptCharacters).trim();
  if (prompt.length < 12) invalid("prompt length (minimum 12 characters)");
  if (r.mode !== undefined && r.mode !== "initial" && r.mode !== "iterate") invalid("research mode");
  if (r.mode !== "iterate") return { prompt, mode: "initial" as const, iteration: null };
  const i = object(r.iteration, "iteration");
  const round = integer(i.round, "research round", 2, MAX_QUALITY_ROUNDS);
  const priorQuestionIds = strings(i.priorQuestionIds, "prior question ids", MAX_SESSION_QUESTIONS, 100);
  unique(priorQuestionIds, "duplicate prior question ids");
  const answeredDecisions = items(i.answeredDecisions, "answered decisions", MAX_SESSION_QUESTIONS).map((item) => {
    const d = object(item, "decision");
    const id = text(d.id, "decision id", 100);
    if (!priorQuestionIds.includes(id)) invalid("decision question id");
    return { id, principle: text(d.principle, "decision principle", 300), question: text(d.question, "decision question", 2000), answer: text(d.answer, "answer", MAX_ANSWER_CHARACTERS) };
  });
  unique(answeredDecisions.map((d) => d.id), "duplicate decisions");
  const rawScore = object(i.score, "score");
  const dimensions = ["artifact", "context", "constraints", "verification", "specificity"];
  const score = Object.fromEntries(dimensions.map((key) => [key, integer(rawScore[key], "score", 0, 100)]));
  const weakDimensions = strings(i.weakDimensions, "weak dimensions", 5, 20);
  if (weakDimensions.some((key) => !dimensions.includes(key))) invalid("weak dimensions");
  return { prompt, mode: "iterate" as const, iteration: {
    round, priorQuestionIds, answeredDecisions, score,
    overall: integer(i.overall, "overall score", 0, 100), weakDimensions,
    researchBrief: parseResearchBrief(i.researchBrief), qualityGate: 85,
  } };
}
export type ResearchRequest = ReturnType<typeof parseResearchRequest>;

export function parseSession(value: unknown, userId: string): SavedPrompt {
  const s = object(value, "session");
  if (s.workspaceId !== `${userId}:default`) invalid("workspace");
  if (s.stage !== "questions" && s.stage !== "result") invalid("session stage");
  const result = parseResearchResult(s, { allowEmptySources: true, maxQuestions: MAX_SESSION_QUESTIONS, maxSources: 8 });
  const ids = new Set(result.questions.map((q) => q.id));
  const answers: Answer[] = items(s.answers, "answers", MAX_SESSION_QUESTIONS).map((item) => {
    const a = object(item, "answer");
    const questionId = text(a.questionId, "answer question id", 100);
    if (!ids.has(questionId)) invalid("answer question id");
    return { questionId, value: text(a.value, "answer", MAX_ANSWER_CHARACTERS) };
  });
  unique(answers.map((a) => a.questionId), "duplicate answers");
  const timestamp = (value: unknown) => {
    const v = text(value, "timestamp", 40);
    if (!Number.isFinite(Date.parse(v))) invalid("timestamp");
    return new Date(v).toISOString();
  };
  return {
    id: text(s.id, "session id", 100), workspaceId: s.workspaceId,
    title: text(s.title, "title", 160), prompt: text(s.prompt, "prompt", MAX_PROMPT_CHARACTERS),
    ...result, answers, compiledPrompt: text(s.compiledPrompt, "compiled prompt", 350_000, true), stage: s.stage,
    createdAt: timestamp(s.createdAt), updatedAt: timestamp(s.updatedAt),
    ...(s.qualityRound === undefined ? {} : { qualityRound: integer(s.qualityRound, "research round", 1, MAX_QUALITY_ROUNDS) }),
    ...(s.questionIndex === undefined ? {} : { questionIndex: integer(s.questionIndex, "question index", 0, result.questions.length - 1) }),
  };
}

export async function readJsonBody(request: Request | Response, maxBytes: number): Promise<unknown> {
  const length = request.headers.get("content-length");
  const tooLarge = () => new HttpError(413, "BODY_TOO_LARGE", "Request body is too large.");
  if (length && Number(length) > maxBytes) throw tooLarge();
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, "INVALID_JSON", "Request body must be valid JSON.");
  let bytes = 0;
  let content = "";
  const decoder = new TextDecoder();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) {
        void reader.cancel().catch(() => {});
        throw tooLarge();
      }
      content += decoder.decode(value, { stream: true });
    }
    content += decoder.decode();
  } finally { reader.releaseLock(); }
  try { return JSON.parse(content); }
  catch { throw new HttpError(400, "INVALID_JSON", "Request body must be valid JSON."); }
}
