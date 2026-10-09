import type { SavedPrompt } from "./types.ts";
import { MAX_QUALITY_ROUNDS } from "./promptEngine.ts";
import type { RefineResponse } from "./provider.ts";

export function getSessionProgress(session: SavedPrompt) {
  const firstUnanswered = session.questions.findIndex((q) => !session.answers.some((a) => a.questionId === q.id));
  return {
    qualityRound: session.qualityRound ?? MAX_QUALITY_ROUNDS,
    questionIndex: Math.min(session.questionIndex ?? Math.max(0, firstUnanswered), Math.max(0, session.questions.length - 1)),
  };
}

/** Per-session ordering prevents older writes overtaking newer answers in one browser. */
export class SessionWriter {
  private pending = new Map<string, Promise<SavedPrompt>>();
  private write: (session: SavedPrompt) => Promise<SavedPrompt>;
  constructor(write: (session: SavedPrompt) => Promise<SavedPrompt>) { this.write = write; }
  save(session: SavedPrompt): Promise<SavedPrompt> {
    const previous = this.pending.get(session.id) ?? Promise.resolve();
    const next = previous.catch(() => {}).then(() => this.write(session));
    this.pending.set(session.id, next);
    const cleanup = () => { if (this.pending.get(session.id) === next) this.pending.delete(session.id); };
    void next.then(cleanup, cleanup);
    return next;
  }
  async drain(id: string): Promise<void> { await this.pending.get(id)?.catch(() => {}); }
}

export function mergeResearch(current: RefineResponse, next: RefineResponse): RefineResponse {
  const ids = new Set(current.questions.map((q) => q.id));
  const fresh = next.questions.filter((q) => !ids.has(q.id));
  if (!fresh.length) throw new Error("Quality iteration returned no new questions.");
  const uniqueBy = <T>(values: T[], key: (value: T) => string, max: number): T[] => {
    const seen = new Set<string>();
    return values.filter((v) => { const k = key(v); if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, max);
  };
  return {
    questions: [...current.questions, ...fresh],
    sources: uniqueBy([...next.sources, ...current.sources], (s) => s.url, 8),
    researchBrief: {
      domain: next.researchBrief.domain, taskType: next.researchBrief.taskType,
      practices: uniqueBy([...next.researchBrief.practices, ...current.researchBrief.practices], (p) => p.title, 6),
      toolPlan: uniqueBy([...next.researchBrief.toolPlan, ...current.researchBrief.toolPlan], (s) => s, 8),
      verificationPlan: uniqueBy([...next.researchBrief.verificationPlan, ...current.researchBrief.verificationPlan], (s) => s, 8),
    },
  };
}
