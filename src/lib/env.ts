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
  /** Public origin, e.g. https://intel.maduuray.com. Drives the Secure cookie flag. */
  APP_URL: optionalString,
  /** Gemini API key for the AI Analyst (Phase 6). */
  GEMINI_API_KEY: optionalString,
  /** Gemini model id for the AI Analyst. Selected and validated in Phase 6. */
  GEMINI_MODEL: optionalString,
  LOG_LEVEL: optionalString,
});

export type DatabaseConfig = {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  connectionLimit: number;
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

export function getAiConfig(): { apiKey: string; model: string | undefined } | null {
  const env = envSchema.parse(process.env);
  return env.GEMINI_API_KEY ? { apiKey: env.GEMINI_API_KEY, model: env.GEMINI_MODEL } : null;
}
