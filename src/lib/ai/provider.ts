import { getAiConfig } from "@/lib/env";
import { createGroqProvider } from "@/lib/ai/groq";
import type { AiProvider } from "@/lib/ai/types";

export {
  AiProviderError,
  type AiErrorCode,
  type AiProvider,
  type GenerateJsonRequest,
  type GenerateJsonResult,
  type JsonSchema,
} from "@/lib/ai/types";

/**
 * Provider-neutral LLM interface (docs/architecture.md §7). Analytics code
 * depends on this, never on a vendor SDK, so Groq can be swapped (e.g. for
 * Gemini) without touching the insight logic. Server-side only.
 */
const globalForAi = globalThis as unknown as { __uciAiProvider?: AiProvider | null };

/** Test hook: use a fake provider instead of the env-configured one (null = not configured). */
export function setAiProvider(provider: AiProvider | null | undefined): void {
  if (provider === undefined) delete globalForAi.__uciAiProvider;
  else globalForAi.__uciAiProvider = provider;
}

/** The configured provider, or null when AI is not configured. */
export function getAiProvider(): AiProvider | null {
  if (globalForAi.__uciAiProvider !== undefined) return globalForAi.__uciAiProvider;
  const config = getAiConfig();
  return config ? createGroqProvider({ apiKey: config.apiKey, model: config.model, baseUrl: config.baseUrl }) : null;
}
