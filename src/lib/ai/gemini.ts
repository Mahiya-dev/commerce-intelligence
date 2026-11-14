/**
 * Google Gemini API. AI Analyst provider (Phase 6). Server-side only; the API
 * key is sent in the x-goog-api-key header (never in the URL, so it cannot end
 * up in access logs). Docs: https://aistudio.google.com/api-reference/models
 */
export const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta";

export type AiVerifyResult =
  | { ok: true; models: string[] }
  | { ok: false; reason: "invalid_key" | "unreachable" | "rate_limited" | "error"; status?: number };

type ModelList = {
  models?: { name?: unknown; supportedGenerationMethods?: unknown }[];
  nextPageToken?: unknown;
};

/** Checks a key by listing models; returns ids that support generateContent ("gemini-…"). */
export async function verifyGeminiKey(
  apiKey: string,
  { fetchImpl = fetch, timeoutMs = 10_000 }: { fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<AiVerifyResult> {
  const models: string[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < 5; page++) {
    const url = `${GEMINI_API_BASE}/models?pageSize=1000${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""}`;
    let res: Response;
    try {
      res = await fetchImpl(url, {
        headers: { "x-goog-api-key": apiKey, Accept: "application/json" },
        signal: AbortSignal.timeout(timeoutMs),
        cache: "no-store",
      });
    } catch {
      return { ok: false, reason: "unreachable" };
    }
    // An invalid key is reported as 400 (API_KEY_INVALID) or 401/403.
    if (res.status === 400 || res.status === 401 || res.status === 403) {
      return { ok: false, reason: "invalid_key", status: res.status };
    }
    if (res.status === 429) return { ok: false, reason: "rate_limited", status: res.status };
    if (!res.ok) return { ok: false, reason: "error", status: res.status };
    let body: ModelList;
    try {
      body = (await res.json()) as ModelList;
    } catch {
      return { ok: false, reason: "error", status: res.status };
    }
    for (const m of body.models ?? []) {
      const methods = Array.isArray(m.supportedGenerationMethods) ? m.supportedGenerationMethods : [];
      if (typeof m.name === "string" && methods.includes("generateContent")) {
        models.push(m.name.replace(/^models\//, ""));
      }
    }
    pageToken = typeof body.nextPageToken === "string" && body.nextPageToken ? body.nextPageToken : undefined;
    if (!pageToken) break;
  }
  return { ok: true, models: models.sort() };
}

export const GEMINI_VERIFY_MESSAGES: Record<Exclude<AiVerifyResult, { ok: true }>["reason"], string> = {
  invalid_key: "API Key ditolak oleh Google. Periksa kembali key di aistudio.google.com → Get API key.",
  unreachable: "Tidak dapat menghubungi Gemini API. Periksa koneksi server lalu coba lagi.",
  rate_limited: "Gemini API membatasi permintaan (rate limit). Coba lagi beberapa saat lagi.",
  error: "Gemini API mengembalikan kesalahan. Coba lagi beberapa saat lagi.",
};
