import { withAuth } from "@workos-inc/authkit-nextjs";
import { NextResponse } from "next/server";

import { getOrCreateProfile, saveProfile } from "@/lib/db";
import type {
  DetailLevel,
  InstructionFileId,
  PlatformId,
  ToolId,
  UserProfile,
} from "@/types";

const PLATFORMS = new Set<PlatformId>(["cursor", "claude-code", "codex", "generic"]);
const TOOLS = new Set<ToolId>(["context7", "graphify", "headroom", "web-search"]);
const INSTRUCTION_FILES = new Set<InstructionFileId>([
  "agents-md",
  "claude-md",
  "cursor-rules",
]);
const DETAIL_LEVELS = new Set<DetailLevel>(["focused", "thorough", "exhaustive"]);

function stringArray<T extends string>(value: unknown, allowed: Set<T>): T[] | null {
  if (!Array.isArray(value) || value.length > allowed.size) return null;
  const result = value.filter(
    (item): item is T => typeof item === "string" && allowed.has(item as T),
  );
  return result.length === value.length ? [...new Set(result)] : null;
}

function parseProfile(value: unknown, userId: string): UserProfile | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<UserProfile>;
  const platforms = stringArray(candidate.platforms, PLATFORMS);
  const tools = stringArray(candidate.tools, TOOLS);
  const instructionFiles = stringArray(candidate.instructionFiles, INSTRUCTION_FILES);
  const preferences = candidate.preferences;
  const workspace = candidate.workspace;

  if (
    typeof candidate.onboardingCompleted !== "boolean" ||
    !platforms ||
    !tools ||
    !instructionFiles ||
    !preferences ||
    typeof preferences !== "object" ||
    !DETAIL_LEVELS.has(preferences.detailLevel) ||
    typeof preferences.researchByDefault !== "boolean" ||
    typeof preferences.includeToolPlan !== "boolean" ||
    typeof preferences.askOnlyMissing !== "boolean" ||
    typeof preferences.customInstructions !== "string" ||
    preferences.customInstructions.length > 2_000 ||
    !workspace ||
    typeof workspace !== "object" ||
    typeof workspace.name !== "string" ||
    workspace.name.trim().length < 1 ||
    workspace.name.length > 80
  ) {
    return null;
  }

  const workspacePlatforms = stringArray(workspace.overrides?.platforms, PLATFORMS);
  const workspaceTools = stringArray(workspace.overrides?.tools, TOOLS);
  const workspaceInstructionFiles = stringArray(
    workspace.overrides?.instructionFiles,
    INSTRUCTION_FILES,
  );
  if (!workspacePlatforms || !workspaceTools || !workspaceInstructionFiles) return null;

  return {
    onboardingCompleted: candidate.onboardingCompleted,
    platforms,
    tools,
    instructionFiles,
    preferences: {
      detailLevel: preferences.detailLevel,
      researchByDefault: preferences.researchByDefault,
      includeToolPlan: preferences.includeToolPlan,
      askOnlyMissing: preferences.askOnlyMissing,
      customInstructions: preferences.customInstructions.trim(),
    },
    workspace: {
      id:
        typeof workspace.id === "string" && workspace.id === `${userId}:default`
          ? workspace.id
          : `${userId}:default`,
      name: workspace.name.trim(),
      overrides: {
        platforms: workspacePlatforms,
        tools: workspaceTools,
        instructionFiles: workspaceInstructionFiles,
      },
    },
  };
}

export async function GET() {
  const { user } = await withAuth();
  if (!user) return NextResponse.json({ error: "Sign in is required." }, { status: 401 });

  try {
    return NextResponse.json({ profile: await getOrCreateProfile(user.id, user.email) });
  } catch (error) {
    console.error("[Profile] Load failed", error);
    return NextResponse.json({ error: "Your profile could not be loaded." }, { status: 503 });
  }
}

export async function PUT(request: Request) {
  const { user } = await withAuth();
  if (!user) return NextResponse.json({ error: "Sign in is required." }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  const value =
    body && typeof body === "object" && "profile" in body
      ? (body as { profile: unknown }).profile
      : null;
  const profile = parseProfile(value, user.id);
  if (!profile) {
    return NextResponse.json({ error: "Profile settings are invalid." }, { status: 400 });
  }

  try {
    return NextResponse.json({ profile: await saveProfile(user.id, user.email, profile) });
  } catch (error) {
    console.error("[Profile] Save failed", error);
    return NextResponse.json({ error: "Your profile could not be saved." }, { status: 503 });
  }
}
