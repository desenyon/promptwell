import type { UserProfile } from "../../types.ts";
import { HttpError, errorResponse } from "../http.ts";
import { object, parseResearchRequest, parseResearchResult, readJsonBody } from "../validation.ts";
import type { EngineConfig } from "./config.ts";
import { ResearchLimits } from "./limits.ts";
import { buildResearchPayload } from "./request.ts";

interface Dependencies {
  config: () => EngineConfig;
  loadProfile: (id: string, email: string) => Promise<UserProfile>;
  fetch: typeof fetch;
  limits: ResearchLimits;
  log: (event: string, details?: Record<string, unknown>) => void;
}

function outputText(value: unknown): string {
  const response = object(value, "provider response");
  if (response.status !== "completed" || !Array.isArray(response.output)) throw new Error("Incomplete response");
  const chunks: string[] = [];
  for (const item of response.output) {
    const output = object(item, "output");
    if (output.type !== "message" || !Array.isArray(output.content)) continue;
    for (const part of output.content) {
      const content = object(part, "content");
      if (content.type === "refusal") throw new Error("Provider refusal");
      if (content.type === "output_text" && typeof content.text === "string") chunks.push(content.text);
    }
  }
  if (!chunks.length) throw new Error("No output text");
  return chunks.join("");
}

export async function handleResearch(request: Request, user: { id: string; email: string } | null, deps: Dependencies): Promise<Response> {
  if (!user) return errorResponse(new HttpError(401, "UNAUTHORIZED", "Sign in is required."));
  let config: EngineConfig;
  try { config = deps.config(); }
  catch { return errorResponse(new HttpError(503, "NOT_CONFIGURED", "Prompt research is not configured.")); }

  let input;
  try { input = parseResearchRequest(await readJsonBody(request, 256_000), config.maxPromptCharacters); }
  catch (error) {
    return errorResponse(error instanceof HttpError ? error : new HttpError(400, "INVALID_INPUT", "Request could not be read."));
  }
  if (request.signal.aborted) return errorResponse(new HttpError(499, "CANCELLED", "Research was cancelled."));

  let reservation;
  try { reservation = deps.limits.reserve(user.id, config); }
  catch (error) {
    if (error instanceof HttpError) return errorResponse(error);
    throw error;
  }
  let profile: UserProfile;
  try { profile = await deps.loadProfile(user.id, user.email); }
  catch {
    reservation.release();
    deps.log("profile_unavailable");
    return errorResponse(new HttpError(503, "PROFILE_UNAVAILABLE", "Your saved prompting profile could not be loaded."));
  }
  if (!profile.onboardingCompleted) {
    reservation.release();
    return errorResponse(new HttpError(409, "ONBOARDING_REQUIRED", "Complete onboarding before researching a prompt."));
  }

  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(), config.timeoutMs);
  const signal = AbortSignal.any([request.signal, deadline.signal]);
  try {
    signal.throwIfAborted();
    const response = await deps.fetch("https://api.openai.com/v1/responses", {
      method: "POST", signal,
      headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(buildResearchPayload(input, profile, config)),
    });
    if (!response.ok) {
      deps.log("provider_rejected", { status: response.status, requestId: response.headers.get("x-request-id") });
      void response.body?.cancel().catch(() => {});
      throw new Error("Upstream failure");
    }
    const text = outputText(await readJsonBody(response, 512_000));
    const raw = object(JSON.parse(text), "research result");
    // With no retrieval tool available, generated citations have no provenance.
    if (!profile.preferences.researchByDefault) raw.sources = [];
    const result = parseResearchResult(raw, { allowEmptySources: input.mode === "iterate" || !profile.preferences.researchByDefault });
    if (input.iteration) {
      result.questions = result.questions.filter((q) => !input.iteration?.priorQuestionIds.includes(q.id));
      if (!result.questions.length) throw new Error("No new questions");
    }
    signal.throwIfAborted();
    reservation.commit();
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch {
    if (request.signal.aborted) return errorResponse(new HttpError(499, "CANCELLED", "Research was cancelled."));
    if (deadline.signal.aborted) return errorResponse(new HttpError(504, "PROVIDER_TIMEOUT", "Research timed out. Your answers are preserved; try again."));
    deps.log("provider_failed", { mode: input.mode });
    return errorResponse(new HttpError(502, "PROVIDER_FAILED", "Prompt research failed or returned an invalid result. Please try again."));
  } finally {
    clearTimeout(timer);
    reservation.release();
  }
}
