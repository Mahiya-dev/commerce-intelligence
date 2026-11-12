/**
 * Groq (OpenAI-compatible API). Used as an AI Analyst provider (Phase 6).
 * Only server-side; the API key never reaches the browser.
 * Docs: https://console.groq.com/docs/api-reference
 */
export const GROQ_API_BASE = "https://api.groq.com/openai/v1";

export type GroqVerifyResult =
  | { ok: true; models: string[] }
  | { ok: false; reason: "invalid_key" | "unreachable" | "rate_limited" | "error"; status?: number };

/** Checks a key by listing models (GET /models). Never logs or returns the key. */
export async function verifyGroqKey(
  apiKey: string,
  { fetchImpl = fetch, timeoutMs = 10_000 }: { fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<GroqVerifyResult> {
  let res: Response;
  try {
    res = await fetchImpl(`${GROQ_API_BASE}/models`, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
    });
  } catch {
    return { ok: false, reason: "unreachable" };
  }
  if (res.status === 401 || res.status === 403) return { ok: false, reason: "invalid_key", status: res.status };
  if (res.status === 429) return { ok: false, reason: "rate_limited", status: res.status };
  if (!res.ok) return { ok: false, reason: "error", status: res.status };
  try {
    const body = (await res.json()) as { data?: { id?: unknown; active?: unknown }[] };
    const models = (body.data ?? [])
      .filter((m) => typeof m.id === "string" && m.active !== false)
      .map((m) => m.id as string)
      .sort();
    return { ok: true, models };
  } catch {
    return { ok: false, reason: "error", status: res.status };
  }
}

export const GROQ_VERIFY_MESSAGES: Record<Exclude<GroqVerifyResult, { ok: true }>["reason"], string> = {
  invalid_key: "API Key ditolak oleh Groq. Periksa kembali key di console.groq.com → API Keys.",
  unreachable: "Tidak dapat menghubungi Groq. Periksa koneksi server lalu coba lagi.",
  rate_limited: "Groq membatasi permintaan (rate limit). Coba lagi beberapa saat lagi.",
  error: "Groq mengembalikan kesalahan. Coba lagi beberapa saat lagi.",
};
