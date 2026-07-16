export type QuestionKind = "choice" | "text";

export interface Question {
  id: string;
  principle: string;
  prompt: string;
  why: string;
  kind: QuestionKind;
  options?: string[];
  placeholder?: string;
}

export interface Answer {
  questionId: string;
  value: string;
}

export interface ResearchSource {
  title: string;
  url: string;
}

export interface PromptScore {
  artifact: number;
  context: number;
  constraints: number;
  verification: number;
  specificity: number;
}

export type AppStage = "draft" | "questions" | "result";
