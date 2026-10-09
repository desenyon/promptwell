export interface EngineConfig {
  apiKey: string;
  model: "gpt-5.4-mini";
  maxPromptCharacters: number;
  maxOutputTokens: number;
  monthlyRequestCap: number;
  reasoningEffort: "low" | "medium" | "high";
  rateLimitRequests: number;
  rateLimitWindowMs: number;
  timeoutMs: number;
}

export function readEngineConfig(env: Record<string, string | undefined> = process.env): EngineConfig {
  const positive = (name: string, fallback: number, max: number, min = 1) => {
    const raw = env[name] ?? String(fallback);
    const value = Number(raw);
    if (!/^\d+$/.test(raw) || !Number.isSafeInteger(value) || value < min || value > max) {
      throw new Error(`${name} must be an integer between ${min} and ${max}.`);
    }
    return value;
  };
  const apiKey = env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured.");
  const model = env.OPENAI_MODEL?.trim() ?? "gpt-5.4-mini";
  if (model !== "gpt-5.4-mini") throw new Error("OPENAI_MODEL must be gpt-5.4-mini.");
  const reasoningEffort = env.OPENAI_REASONING_EFFORT?.trim() ?? "low";
  if (reasoningEffort !== "low" && reasoningEffort !== "medium" && reasoningEffort !== "high") {
    throw new Error("OPENAI_REASONING_EFFORT must be low, medium, or high.");
  }
  return {
    apiKey, model, reasoningEffort,
    maxPromptCharacters: positive("PROMPT_MAX_CHARACTERS", 12000, 12000, 12),
    maxOutputTokens: positive("PROMPT_MAX_OUTPUT_TOKENS", 6000, 16000),
    monthlyRequestCap: positive("OPENAI_MONTHLY_REQUEST_CAP", 250, 1_000_000),
    rateLimitRequests: positive("PROMPT_RATE_LIMIT_REQUESTS", 10, 10_000),
    rateLimitWindowMs: positive("PROMPT_RATE_LIMIT_WINDOW_MS", 600000, 86_400_000),
    timeoutMs: positive("PROMPT_REQUEST_TIMEOUT_MS", 60000, 120000, 1000),
  };
}
