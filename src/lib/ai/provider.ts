import { getGroqEnvConfig, DEFAULT_GROQ_MODEL } from "@/lib/env";
import type { ActiveSession } from "@/lib/auth/sessions";
import { getAiApiKey, isAiKeyAvailable } from "@/lib/organization/ai-credentials";
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
 *
 * Key resolution: the Groq key the Owner stored in Pengaturan → Organisasi
 * (encrypted, per organization) first, then GROQ_API_KEY from the server
 * environment.
 */
const globalForAi = globalThis as unknown as { __uciAiProvider?: AiProvider | null };

/** Test hook: use a fake provider instead of the configured one (null = not configured). */
export function setAiProvider(provider: AiProvider | null | undefined): void {
  if (provider === undefined) delete globalForAi.__uciAiProvider;
  else globalForAi.__uciAiProvider = provider;
}

/** Whether AI is configured for the organization (no key is decrypted; any role). */
export async function isAiConfigured(session: ActiveSession): Promise<boolean> {
  if (globalForAi.__uciAiProvider !== undefined) return globalForAi.__uciAiProvider !== null;
  return isAiKeyAvailable(session, "groq");
}

/** The provider for this organization, or null when AI is not configured. Requires "ai:ask". */
export async function getAiProvider(session: ActiveSession): Promise<AiProvider | null> {
  if (globalForAi.__uciAiProvider !== undefined) return globalForAi.__uciAiProvider;
  const key = await getAiApiKey(session, "groq");
  if (!key) return null;
  const env = getGroqEnvConfig();
  return createGroqProvider({
    apiKey: key.apiKey,
    model: key.model ?? env?.model ?? DEFAULT_GROQ_MODEL,
    baseUrl: env?.baseUrl,
  });
}
