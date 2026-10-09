import { withAuth } from "@workos-inc/authkit-nextjs";
import { NextResponse } from "next/server";

import { deleteSession, listSessions, upsertSession } from "@/lib/db";
import { parseSession, readJsonBody } from "@/lib/validation";
import { HttpError, errorResponse } from "@/lib/http";

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
    if (error instanceof HttpError) return errorResponse(error);
    console.error("[Sessions] Load failed", error);
    return NextResponse.json({ error: "History could not be loaded." }, { status: 503 });
  }
}

export async function PUT(request: Request) {
  const { user } = await withAuth();
  if (!user) return NextResponse.json({ error: "Sign in is required." }, { status: 401 });

  let session;
  try {
    const body = await readJsonBody(request, 2_000_000);
    const value = body && typeof body === "object" && "session" in body ? body.session : null;
    session = parseSession(value, user.id);
  } catch (error) {
    return errorResponse(error instanceof HttpError ? error : new HttpError(400, "INVALID_INPUT", "Prompt session is invalid."));
  }

  try {
    return NextResponse.json({ session: await upsertSession(user.id, session) });
  } catch (error) {
    if (error instanceof HttpError) return errorResponse(error);
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
    if (error instanceof HttpError) return errorResponse(error);
    console.error("[Sessions] Delete failed", error);
    return NextResponse.json({ error: "Prompt session could not be deleted." }, { status: 503 });
  }
}
