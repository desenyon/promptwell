import type { SavedPrompt, UserProfile } from "./types";

async function responseError(response: Response, fallback: string): Promise<Error> {
  const body = (await response.json().catch(() => null)) as { error?: string } | null;
  return new Error(body?.error ?? fallback);
}

export async function loadProfile(): Promise<UserProfile> {
  const response = await fetch("/api/profile", { cache: "no-store" });
  if (!response.ok) throw await responseError(response, "Profile could not be loaded.");
  const body = (await response.json()) as { profile?: UserProfile };
  if (!body.profile) throw new Error("Profile response was incomplete.");
  return body.profile;
}

export async function updateProfile(profile: UserProfile): Promise<UserProfile> {
  const response = await fetch("/api/profile", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ profile }),
  });
  if (!response.ok) throw await responseError(response, "Profile could not be saved.");
  const body = (await response.json()) as { profile?: UserProfile };
  if (!body.profile) throw new Error("Profile response was incomplete.");
  return body.profile;
}

export async function loadSessions(workspaceId: string): Promise<SavedPrompt[]> {
  const response = await fetch(
    `/api/sessions?workspaceId=${encodeURIComponent(workspaceId)}`,
    { cache: "no-store" },
  );
  if (!response.ok) throw await responseError(response, "History could not be loaded.");
  const body = (await response.json()) as { sessions?: SavedPrompt[] };
  return Array.isArray(body.sessions) ? body.sessions : [];
}

export async function saveSession(session: SavedPrompt): Promise<SavedPrompt> {
  const response = await fetch("/api/sessions", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ session }),
  });
  if (!response.ok) throw await responseError(response, "Prompt could not be saved.");
  const body = (await response.json()) as { session?: SavedPrompt };
  if (!body.session) throw new Error("Saved prompt response was incomplete.");
  return body.session;
}

export async function removeSession(sessionId: string): Promise<void> {
  const response = await fetch(`/api/sessions?id=${encodeURIComponent(sessionId)}`, {
    method: "DELETE",
  });
  if (!response.ok && response.status !== 404) {
    throw await responseError(response, "Prompt could not be deleted.");
  }
}
