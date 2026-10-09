import postgres, { type Sql } from "postgres";
import { HttpError } from "./http.ts";

import type {
  Answer,
  InstructionFileId,
  PlatformId,
  PromptPreferences,
  Question,
  ResearchBrief,
  ResearchSource,
  SavedPrompt,
  ToolId,
  UserProfile,
} from "../types.ts";

const DEFAULT_PREFERENCES: PromptPreferences = {
  detailLevel: "thorough",
  researchByDefault: true,
  includeToolPlan: true,
  askOnlyMissing: true,
  customInstructions: "",
};

const EMPTY_RESEARCH_BRIEF: ResearchBrief = {
  domain: "",
  taskType: "",
  practices: [],
  toolPlan: [],
  verificationPlan: [],
};

interface ProfileRow {
  onboarding_completed: boolean;
  platforms: PlatformId[];
  tools: ToolId[];
  instruction_files: InstructionFileId[];
  preferences: PromptPreferences;
  workspace_id: string;
  workspace_name: string;
  workspace_overrides: UserProfile["workspace"]["overrides"];
}

interface SessionRow {
  id: string;
  workspace_id: string;
  title: string;
  prompt: string;
  questions: Question[];
  answers: Answer[];
  sources: ResearchSource[];
  research_brief: ResearchBrief;
  compiled_prompt: string;
  stage: SavedPrompt["stage"];
  quality_round: number;
  question_index: number;
  created_at: Date | string;
  updated_at: Date | string;
}

const globalForDatabase = globalThis as typeof globalThis & {
  promptwellDatabase?: Sql;
};

function database(): Sql {
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) {
    throw new Error("DATABASE_URL is not configured.");
  }

  if (!globalForDatabase.promptwellDatabase) {
    globalForDatabase.promptwellDatabase = postgres(connectionString, {
      max: 3,
      idle_timeout: 20,
      connect_timeout: 10,
      prepare: false,
    });
  }

  return globalForDatabase.promptwellDatabase;
}

/** Fail closed during an application-first deploy; never mutate the schema at runtime. */
async function requireSessionSchema(sql: Sql): Promise<void> {
  const [schema] = await sql<{ ready: boolean }[]>`
    SELECT count(*) = 2 AS ready
    FROM information_schema.columns
    WHERE table_schema = 'promptwell' AND table_name = 'sessions'
      AND column_name IN ('quality_round', 'question_index')
      AND data_type = 'integer' AND is_nullable = 'NO'
  `;
  // Do not cache this result: the next request must recover after migration.
  if (!schema.ready) {
    throw new HttpError(503, "SCHEMA_MIGRATION_REQUIRED",
      "Promptwell is temporarily unavailable while a database update is pending. Your saved prompts are unchanged. Try again after the update.");
  }
}

function defaultWorkspaceId(userId: string): string {
  return `${userId}:default`;
}

function toJson(value: unknown) {
  return JSON.parse(JSON.stringify(value));
}

function profileFromRow(row: ProfileRow): UserProfile {
  return {
    onboardingCompleted: row.onboarding_completed,
    platforms: row.platforms ?? [],
    tools: row.tools ?? [],
    instructionFiles: row.instruction_files ?? [],
    preferences: {
      ...DEFAULT_PREFERENCES,
      ...(row.preferences ?? {}),
    },
    workspace: {
      id: row.workspace_id,
      name: row.workspace_name,
      overrides: {
        platforms: row.workspace_overrides?.platforms ?? [],
        tools: row.workspace_overrides?.tools ?? [],
        instructionFiles: row.workspace_overrides?.instructionFiles ?? [],
      },
    },
  };
}

export async function getOrCreateProfile(
  userId: string,
  email: string,
): Promise<UserProfile> {
  const sql = database();
  await requireSessionSchema(sql);
  const workspaceId = defaultWorkspaceId(userId);

  await sql.begin(async (transaction) => {
    await transaction`
      INSERT INTO promptwell.profiles (user_id, email)
      VALUES (${userId}, ${email})
      ON CONFLICT (user_id) DO UPDATE
      SET email = EXCLUDED.email, updated_at = now()
    `;
    await transaction`
      INSERT INTO promptwell.workspaces (id, user_id, name)
      VALUES (${workspaceId}, ${userId}, 'Personal workspace')
      ON CONFLICT (id) DO NOTHING
    `;
  });

  const [row] = await sql<ProfileRow[]>`
    SELECT
      profile.onboarding_completed,
      profile.platforms,
      profile.tools,
      profile.instruction_files,
      profile.preferences,
      workspace.id AS workspace_id,
      workspace.name AS workspace_name,
      workspace.overrides AS workspace_overrides
    FROM promptwell.profiles AS profile
    JOIN promptwell.workspaces AS workspace
      ON workspace.user_id = profile.user_id
    WHERE profile.user_id = ${userId}
    ORDER BY workspace.created_at ASC
    LIMIT 1
  `;

  if (!row) throw new Error("Profile could not be loaded.");
  return profileFromRow(row);
}

export async function saveProfile(
  userId: string,
  email: string,
  profile: UserProfile,
): Promise<UserProfile> {
  const sql = database();
  await requireSessionSchema(sql);
  const workspaceId = profile.workspace.id || defaultWorkspaceId(userId);

  await sql.begin(async (transaction) => {
    await transaction`
      INSERT INTO promptwell.profiles (
        user_id,
        email,
        onboarding_completed,
        platforms,
        tools,
        instruction_files,
        preferences,
        updated_at
      )
      VALUES (
        ${userId},
        ${email},
        ${profile.onboardingCompleted},
        ${transaction.array(profile.platforms)},
        ${transaction.array(profile.tools)},
        ${transaction.array(profile.instructionFiles)},
        ${transaction.json(toJson(profile.preferences))},
        now()
      )
      ON CONFLICT (user_id) DO UPDATE SET
        email = EXCLUDED.email,
        onboarding_completed = EXCLUDED.onboarding_completed,
        platforms = EXCLUDED.platforms,
        tools = EXCLUDED.tools,
        instruction_files = EXCLUDED.instruction_files,
        preferences = EXCLUDED.preferences,
        updated_at = now()
    `;
    await transaction`
      INSERT INTO promptwell.workspaces (id, user_id, name, overrides, updated_at)
      VALUES (
        ${workspaceId},
        ${userId},
        ${profile.workspace.name.trim() || "Personal workspace"},
        ${transaction.json(toJson(profile.workspace.overrides))},
        now()
      )
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        overrides = EXCLUDED.overrides,
        updated_at = now()
      WHERE promptwell.workspaces.user_id = ${userId}
    `;
  });

  return getOrCreateProfile(userId, email);
}

function sessionFromRow(row: SessionRow): SavedPrompt {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    title: row.title,
    prompt: row.prompt,
    questions: row.questions ?? [],
    answers: row.answers ?? [],
    sources: row.sources ?? [],
    researchBrief: row.research_brief ?? EMPTY_RESEARCH_BRIEF,
    compiledPrompt: row.compiled_prompt,
    stage: row.stage,
    qualityRound: row.quality_round,
    questionIndex: row.question_index,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

export async function listSessions(
  userId: string,
  workspaceId: string,
  limit = 100,
): Promise<SavedPrompt[]> {
  const sql = database();
  await requireSessionSchema(sql);
  const rows = await sql<SessionRow[]>`
    SELECT
      id,
      workspace_id,
      title,
      prompt,
      questions,
      answers,
      sources,
      research_brief,
      compiled_prompt,
      stage,
      quality_round,
      question_index,
      created_at,
      updated_at
    FROM promptwell.sessions
    WHERE user_id = ${userId} AND workspace_id = ${workspaceId}
    ORDER BY updated_at DESC
    LIMIT ${limit}
  `;
  return rows.map(sessionFromRow);
}

export async function upsertSession(
  userId: string,
  session: SavedPrompt,
): Promise<SavedPrompt> {
  const sql = database();
  await requireSessionSchema(sql);
  const [row] = await sql<SessionRow[]>`
    INSERT INTO promptwell.sessions (
      id,
      user_id,
      workspace_id,
      title,
      prompt,
      questions,
      answers,
      sources,
      research_brief,
      compiled_prompt,
      stage,
      quality_round,
      question_index,
      created_at,
      updated_at
    )
    SELECT
      ${session.id},
      ${userId},
      workspace.id,
      ${session.title},
      ${session.prompt},
      ${sql.json(toJson(session.questions))},
      ${sql.json(toJson(session.answers))},
      ${sql.json(toJson(session.sources))},
      ${sql.json(toJson(session.researchBrief))},
      ${session.compiledPrompt},
      ${session.stage},
      ${session.qualityRound ?? 4},
      ${session.questionIndex ?? 0},
      now(),
      now()
    FROM promptwell.workspaces AS workspace
    WHERE workspace.id = ${session.workspaceId} AND workspace.user_id = ${userId}
    ON CONFLICT (id) DO UPDATE SET
      title = EXCLUDED.title,
      prompt = EXCLUDED.prompt,
      questions = EXCLUDED.questions,
      answers = EXCLUDED.answers,
      sources = EXCLUDED.sources,
      research_brief = EXCLUDED.research_brief,
      compiled_prompt = EXCLUDED.compiled_prompt,
      stage = EXCLUDED.stage,
      quality_round = GREATEST(promptwell.sessions.quality_round, COALESCE(${session.qualityRound ?? null}::integer, promptwell.sessions.quality_round)),
      question_index = COALESCE(${session.questionIndex ?? null}::integer, promptwell.sessions.question_index),
      updated_at = now()
    WHERE promptwell.sessions.user_id = ${userId}
    RETURNING
      id,
      workspace_id,
      title,
      prompt,
      questions,
      answers,
      sources,
      research_brief,
      compiled_prompt,
      stage,
      quality_round,
      question_index,
      created_at,
      updated_at
  `;

  if (!row) throw new Error("Session workspace was not found.");
  return sessionFromRow(row);
}

export async function deleteSession(userId: string, sessionId: string): Promise<boolean> {
  const sql = database();
  await requireSessionSchema(sql);
  const rows = await sql`
    DELETE FROM promptwell.sessions
    WHERE id = ${sessionId} AND user_id = ${userId}
    RETURNING id
  `;
  return rows.count > 0;
}

export { DEFAULT_PREFERENCES, EMPTY_RESEARCH_BRIEF };
