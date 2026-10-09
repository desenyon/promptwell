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
  practice?: string;
}

export interface ResearchPractice {
  title: string;
  guidance: string;
  application: string;
}

export interface ResearchBrief {
  domain: string;
  taskType: string;
  practices: ResearchPractice[];
  toolPlan: string[];
  verificationPlan: string[];
}

export interface PromptScore {
  artifact: number;
  context: number;
  constraints: number;
  verification: number;
  specificity: number;
}

export type AppStage = "draft" | "questions" | "result";

export type PlatformId = "cursor" | "claude-code" | "codex" | "generic";
export type ToolId =
  | "context7"
  | "graphify"
  | "headroom"
  | "web-search"
  | "mcp"
  | "skills"
  | "hooks"
  | "optimization";
export type InstructionFileId = "agents-md" | "claude-md" | "cursor-rules";
export type DetailLevel = "focused" | "thorough" | "exhaustive";

export interface PromptPreferences {
  detailLevel: DetailLevel;
  researchByDefault: boolean;
  includeToolPlan: boolean;
  askOnlyMissing: boolean;
  customInstructions: string;
}

export interface WorkspaceProfile {
  id: string;
  name: string;
  overrides: {
    platforms: PlatformId[];
    tools: ToolId[];
    instructionFiles: InstructionFileId[];
  };
}

export interface UserProfile {
  onboardingCompleted: boolean;
  platforms: PlatformId[];
  tools: ToolId[];
  instructionFiles: InstructionFileId[];
  preferences: PromptPreferences;
  workspace: WorkspaceProfile;
}

export interface SavedPrompt {
  id: string;
  workspaceId: string;
  title: string;
  prompt: string;
  questions: Question[];
  answers: Answer[];
  sources: ResearchSource[];
  researchBrief: ResearchBrief;
  compiledPrompt: string;
  stage: Exclude<AppStage, "draft">;
  /** Optional only for compatibility with sessions created before the progress migration. */
  qualityRound?: number;
  questionIndex?: number;
  createdAt: string;
  updatedAt: string;
}
