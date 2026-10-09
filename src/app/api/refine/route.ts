import { withAuth } from "@workos-inc/authkit-nextjs";
import { getOrCreateProfile } from "@/lib/db";
import { readEngineConfig } from "@/lib/research/config";
import { ResearchLimits } from "@/lib/research/limits";
import { handleResearch } from "@/lib/research/service";

export const runtime = "nodejs";
export const maxDuration = 150;

const processState = globalThis as typeof globalThis & { promptwellLimits?: ResearchLimits };
const limits = processState.promptwellLimits ??= new ResearchLimits();

export async function POST(request: Request) {
  const { user } = await withAuth();
  return handleResearch(request, user, {
    config: readEngineConfig,
    loadProfile: getOrCreateProfile,
    fetch,
    limits,
    log: (event, details) => console.error(`[Prompt research] ${event}`, details ?? {}),
  });
}
