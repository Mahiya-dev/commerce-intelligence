import { AiProviderError, type AiProvider, type GenerateJsonRequest } from "@/lib/ai/types";

/**
 * Groq via its OpenAI-compatible Chat Completions endpoint with Structured
 * Outputs (response_format json_schema, strict). The model id comes from
 * GROQ_MODEL; it must support json_schema (e.g. openai/gpt-oss-120b).
 * The response is still validated by the caller (zod) — never trusted as-is.
 */
export const GROQ_BASE_URL = "https://api.groq.com/openai/v1";
export const GROQ_ENDPOINT = `${GROQ_BASE_URL}/chat/completions`;

type GroqResponse = {
  choices?: { message?: { content?: string | null }; finish_reason?: string }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  error?: { message?: string };
};

export function createGroqProvider({
  apiKey,
  model,
  baseUrl = GROQ_BASE_URL,
  timeoutMs = 45_000,
  fetchImpl = fetch,
}: {
  apiKey: string;
  model: string;
  baseUrl?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}): AiProvider {
  return {
    name: "groq",
    model,
    async generateJson(request: GenerateJsonRequest) {
      let res: Response;
      try {
        res = await fetchImpl(`${baseUrl.replace(/\/+$/, "")}/chat/completions`, {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model,
            temperature: 0.2,
            messages: [
              { role: "system", content: request.system },
              { role: "user", content: request.user },
            ],
            response_format: {
              type: "json_schema",
              json_schema: { name: request.schemaName, strict: true, schema: request.schema },
            },
          }),
          signal: AbortSignal.timeout(timeoutMs),
          cache: "no-store",
        });
      } catch (error) {
        const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
        throw new AiProviderError(timedOut ? "timeout" : "unavailable", "Tidak dapat menghubungi layanan AI.");
      }

      if (res.status === 401 || res.status === 403) throw new AiProviderError("auth", "API key AI ditolak.");
      if (res.status === 429) throw new AiProviderError("rate_limited", "Batas pemakaian layanan AI tercapai.");
      if (res.status === 400 || res.status === 404 || res.status === 422) {
        throw new AiProviderError("bad_request", `Layanan AI menolak permintaan (HTTP ${res.status}).`);
      }
      if (!res.ok) throw new AiProviderError("unavailable", `Layanan AI sedang bermasalah (HTTP ${res.status}).`);

      let body: GroqResponse;
      try {
        body = (await res.json()) as GroqResponse;
      } catch {
        throw new AiProviderError("bad_response", "Jawaban layanan AI tidak dapat dibaca.");
      }
      const content = body.choices?.[0]?.message?.content;
      if (!content) throw new AiProviderError("bad_response", "Jawaban layanan AI kosong.");
      let json: unknown;
      try {
        json = JSON.parse(content);
      } catch {
        throw new AiProviderError("bad_response", "Jawaban layanan AI bukan JSON.");
      }
      return {
        json,
        usage: {
          promptTokens: body.usage?.prompt_tokens ?? null,
          completionTokens: body.usage?.completion_tokens ?? null,
        },
      };
    },
  };
}
