import { z } from "zod";

/**
 * Runtime configuration. Everything is SERVER-ONLY and read at runtime (no
 * NEXT_PUBLIC_* values), so the same build can be deployed to any cPanel
 * account by changing environment variables only.
 *
 * Database credentials come from cPanel → MySQL® Databases. Use either the
 * discrete DB_* variables (recommended: passwords with special characters need
 * no URL-encoding) or DATABASE_URL.
 */
const optionalString = z
  .string()
  .optional()
  .transform((v) => (v === undefined || v.trim() === "" ? undefined : v.trim()));

const envSchema = z.object({
  DATABASE_URL: optionalString,
  DB_HOST: optionalString,
  DB_PORT: optionalString,
  DB_USER: optionalString,
  DB_PASSWORD: z.string().optional(),
  DB_NAME: optionalString,
  /** Pool size. Keep small on shared hosting (cPanel limits connections per user). */
  DB_CONNECTION_LIMIT: optionalString,
  /**
   * TLS to the database: "true" for a cloud MySQL (Aiven, TiDB Cloud, …) on a
   * serverless host such as Vercel. Not needed on cPanel (localhost).
   */
  DB_SSL: optionalString,
  /** PEM CA certificate of the database provider (newlines may be written as \n). */
  DB_SSL_CA: optionalString,
  /** Public origin, e.g. https://intel.maduuray.com. Drives the Secure cookie flag. */
  APP_URL: optionalString,
  /** Groq API key for AI insights (console.groq.com). Server-side only. */
  GROQ_API_KEY: optionalString,
  /** Groq model id; must support structured outputs (json_schema). */
  GROQ_MODEL: optionalString,
  /** Optional OpenAI-compatible base URL (default https://api.groq.com/openai/v1). */
  GROQ_BASE_URL: optionalString,
  /** Server-wide Gemini key (fallback when an organization stores none in the dashboard). */
  GEMINI_API_KEY: optionalString,
  /** Gemini model id for GEMINI_API_KEY. */
  GEMINI_MODEL: optionalString,
  LOG_LEVEL: optionalString,
  /**
   * 32-byte key (base64 or 64 hex chars) that encrypts secrets stored in the
   * database, e.g. the Groq API key entered by the Owner. Generate with
   * `openssl rand -base64 32`. Changing it makes stored secrets unreadable
   * (they must be entered again).
   */
  APP_ENCRYPTION_KEY: optionalString,
});

export type DatabaseConfig = {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  connectionLimit: number;
  /** Present when DB_SSL=true: verified TLS (provider CA, or the system CAs). */
  ssl?: { ca?: string; rejectUnauthorized: true; minVersion: "TLSv1.2" };
};

export class ConfigurationError extends Error {
  readonly issues: string[];
  constructor(issues: string[]) {
    super(`Konfigurasi aplikasi tidak lengkap: ${issues.join("; ")}`);
    this.name = "ConfigurationError";
    this.issues = issues;
  }
}

type RawEnv = Record<string, string | undefined>;

/** Pure parser (exported for unit tests and the CLI). */
export function parseDatabaseConfig(raw: RawEnv): DatabaseConfig {
  const env = envSchema.parse(raw);
  const limit = Number(env.DB_CONNECTION_LIMIT ?? 5);
  const connectionLimit = Number.isInteger(limit) && limit >= 1 && limit <= 50 ? limit : 5;
  const sslFlag = (env.DB_SSL ?? "").toLowerCase();
  if (sslFlag && !["true", "false", "1", "0"].includes(sslFlag)) {
    throw new ConfigurationError(["DB_SSL harus true atau false"]);
  }
  const ssl =
    sslFlag === "true" || sslFlag === "1"
      ? {
          ...(env.DB_SSL_CA ? { ca: env.DB_SSL_CA.replace(/\\n/g, "\n") } : {}),
          rejectUnauthorized: true as const,
          minVersion: "TLSv1.2" as const,
        }
      : undefined;

  if (env.DATABASE_URL) {
    let url: URL;
    try {
      url = new URL(env.DATABASE_URL);
    } catch {
      throw new ConfigurationError(["DATABASE_URL bukan URL yang valid"]);
    }
    if (url.protocol !== "mysql:" && url.protocol !== "mariadb:") {
      throw new ConfigurationError(["DATABASE_URL harus diawali mysql://"]);
    }
    const database = decodeURIComponent(url.pathname.replace(/^\//, ""));
    if (!url.hostname || !url.username || !database) {
      throw new ConfigurationError(["DATABASE_URL harus memuat host, user dan nama database"]);
    }
    return {
      host: url.hostname,
      port: url.port ? Number(url.port) : 3306,
      user: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
      database,
      connectionLimit,
      ...(ssl ? { ssl } : {}),
    };
  }

  const issues: string[] = [];
  if (!env.DB_USER) issues.push("DB_USER wajib diisi");
  if (!env.DB_NAME) issues.push("DB_NAME wajib diisi");
  if (env.DB_PASSWORD === undefined) issues.push("DB_PASSWORD wajib diisi");
  const port = Number(env.DB_PORT ?? 3306);
  if (!Number.isInteger(port) || port < 1 || port > 65535) issues.push("DB_PORT tidak valid");
  if (issues.length > 0) throw new ConfigurationError(issues);

  return {
    host: env.DB_HOST ?? "localhost",
    port,
    user: env.DB_USER!,
    password: env.DB_PASSWORD!,
    database: env.DB_NAME!,
    connectionLimit,
    ...(ssl ? { ssl } : {}),
  };
}

export function getDatabaseConfig(): DatabaseConfig {
  return parseDatabaseConfig(process.env);
}

export function isDatabaseConfigured(): boolean {
  try {
    getDatabaseConfig();
    return true;
  } catch {
    return false;
  }
}

/** True when the app is served over HTTPS (cookies get the Secure flag). */
export function isSecureOrigin(): boolean {
  const appUrl = process.env.APP_URL?.trim();
  if (appUrl) return appUrl.startsWith("https://");
  return process.env.NODE_ENV === "production";
}

/** Default Groq model: supports strict structured outputs (json_schema). */
export const DEFAULT_GROQ_MODEL = "openai/gpt-oss-120b";

export type GroqEnvConfig = { provider: "groq"; apiKey: string; model: string; baseUrl: string | undefined };

/**
 * Server-wide Groq settings from the environment, or null without GROQ_API_KEY.
 * A key stored by the Owner in Pengaturan → Organisasi takes precedence
 * (src/lib/organization/ai-credentials.ts).
 */
export function getGroqEnvConfig(): GroqEnvConfig | null {
  const env = envSchema.parse(process.env);
  return env.GROQ_API_KEY
    ? {
        provider: "groq",
        apiKey: env.GROQ_API_KEY,
        model: env.GROQ_MODEL ?? DEFAULT_GROQ_MODEL,
        baseUrl: env.GROQ_BASE_URL,
      }
    : null;
}

/** Server-wide Gemini settings from the environment (fallback), or null without GEMINI_API_KEY. */
export function getGeminiEnvConfig(): { apiKey: string; model: string | undefined } | null {
  const env = envSchema.parse(process.env);
  return env.GEMINI_API_KEY ? { apiKey: env.GEMINI_API_KEY, model: env.GEMINI_MODEL } : null;
}

/** Parsed APP_ENCRYPTION_KEY, or null when missing/invalid (secret storage disabled). */
export function getEncryptionKey(raw: RawEnv = process.env): Buffer | null {
  const value = envSchema.parse(raw).APP_ENCRYPTION_KEY;
  if (!value) return null;
  if (/^[0-9a-fA-F]{64}$/.test(value)) return Buffer.from(value, "hex");
  const buf = Buffer.from(value, "base64");
  return buf.length === 32 && /^[A-Za-z0-9+/]+={0,2}$/.test(value) ? buf : null;
}
