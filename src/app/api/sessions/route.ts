import { withAuth } from "@workos-inc/authkit-nextjs";
import { NextResponse } from "next/server";

import { deleteSession, listSessions, upsertSession } from "@/lib/db";
import type { SavedPrompt } from "@/types";

function parseSession(value: unknown, userId: string): SavedPrompt | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<SavedPrompt>;
  const validStage = candidate.stage === "questions" || candidate.stage === "result";

  if (
    typeof candidate.id !== "string" ||
    candidate.id.length > 100 ||
    candidate.workspaceId !== `${userId}:default` ||
    typeof candidate.title !== "string" ||
    candidate.title.length > 160 ||
    typeof candidate.prompt !== "string" ||
    candidate.prompt.length > 12_000 ||
    !Array.isArray(candidate.questions) ||
    !Array.isArray(candidate.answers) ||
    !Array.isArray(candidate.sources) ||
    !candidate.researchBrief ||
    typeof candidate.researchBrief !== "object" ||
    typeof candidate.compiledPrompt !== "string" ||
    candidate.compiledPrompt.length > 100_000 ||
    !validStage ||
    typeof candidate.createdAt !== "string" ||
    Number.isNaN(Date.parse(candidate.createdAt)) ||
    typeof candidate.updatedAt !== "string" ||
    Number.isNaN(Date.parse(candidate.updatedAt))
  ) {
    return null;
  }

  return candidate as SavedPrompt;
}

export async function GET(request: Request) {
  const { user } = await withAuth();
  if (!user) return NextResponse.json({ error: "Sign in is required." }, { status: 401 });

  const workspaceId =
    new URL(request.url).searchParams.get("workspaceId") ?? `${user.id}:default`;
  if (workspaceId !== `${user.id}:default`) {
    return NextResponse.json({ error: "Workspace was not found." }, { status: 404 });
  }

  try {
    return NextResponse.json({
      sessions: await listSessions(user.id, workspaceId),
    });
  } catch (error) {
    console.error("[Sessions] Load failed", error);
    return NextResponse.json({ error: "History could not be loaded." }, { status: 503 });
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
    body && typeof body === "object" && "session" in body
      ? (body as { session: unknown }).session
      : null;
  const session = parseSession(value, user.id);
  if (!session) {
    return NextResponse.json({ error: "Prompt session is invalid." }, { status: 400 });
  }

  try {
    return NextResponse.json({ session: await upsertSession(user.id, session) });
  } catch (error) {
    console.error("[Sessions] Save failed", error);
    return NextResponse.json({ error: "Prompt session could not be saved." }, { status: 503 });
  }
}

export async function DELETE(request: Request) {
  const { user } = await withAuth();
  if (!user) return NextResponse.json({ error: "Sign in is required." }, { status: 401 });

  const sessionId = new URL(request.url).searchParams.get("id");
  if (!sessionId || sessionId.length > 100) {
    return NextResponse.json({ error: "A valid session id is required." }, { status: 400 });
  }

  try {
    const deleted = await deleteSession(user.id, sessionId);
    return deleted
      ? new NextResponse(null, { status: 204 })
      : NextResponse.json({ error: "Prompt session was not found." }, { status: 404 });
  } catch (error) {
    console.error("[Sessions] Delete failed", error);
    return NextResponse.json({ error: "Prompt session could not be deleted." }, { status: 503 });
  }
}
