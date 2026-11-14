/** Provider-neutral LLM types (docs/architecture.md §7). */
export type JsonSchema = Record<string, unknown>;

export type GenerateJsonRequest = {
  system: string;
  user: string;
  /** Name of the response schema (letters, digits, _ and -). */
  schemaName: string;
  schema: JsonSchema;
};

export type GenerateJsonResult = {
  /** Parsed JSON as returned by the model; callers MUST validate it. */
  json: unknown;
  usage: { promptTokens: number | null; completionTokens: number | null };
};

export interface AiProvider {
  readonly name: string;
  readonly model: string;
  generateJson(request: GenerateJsonRequest): Promise<GenerateJsonResult>;
}

/** Stable, user-safe error codes (stored in ai_requests.error_code). */
export type AiErrorCode = "auth" | "rate_limited" | "timeout" | "unavailable" | "bad_response" | "bad_request";

export class AiProviderError extends Error {
  constructor(
    readonly code: AiErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "AiProviderError";
  }
}
