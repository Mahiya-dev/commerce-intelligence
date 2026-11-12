import { z } from "zod";
import { execute, getPool, queryOne, withTransaction, type Queryable } from "@/lib/db/pool";
import { writeAudit } from "@/lib/audit";
import { can, hasRole } from "@/lib/auth/roles";
import type { ActiveSession } from "@/lib/auth/sessions";
import { AuthorizationError } from "@/lib/data/master-data";
import { getAiConfig, getEncryptionKey } from "@/lib/env";
import { decryptSecret, encryptSecret, secretHint } from "@/lib/crypto/secret-box";
import { GROQ_VERIFY_MESSAGES, verifyGroqKey } from "@/lib/ai/groq";
import { GEMINI_VERIFY_MESSAGES, verifyGeminiKey } from "@/lib/ai/gemini";

/**
 * AI provider credentials per organization (migrations 0008, 0013): Gemini
 * and Groq. Only the Owner ("organization:manage") can set or remove a key.
 * Keys are encrypted with APP_ENCRYPTION_KEY and bound to organization +
 * provider; reads for display return a hint only. Plaintext keys are only
 * available server-side via getAiApiKey() for the AI Analyst. Audit entries
 * never contain a key.
 *
 * Gemini falls back to GEMINI_API_KEY / GEMINI_MODEL from the server
 * environment when the organization has not stored its own key.
 */

export const AI_PROVIDERS = ["gemini", "groq"] as const;
export type AiProvider = (typeof AI_PROVIDERS)[number];

export const AI_PROVIDER_LABELS: Record<AiProvider, string> = { gemini: "Google Gemini", groq: "Groq" };

const VERIFY = {
  gemini: { verify: verifyGeminiKey, messages: GEMINI_VERIFY_MESSAGES },
  groq: { verify: verifyGroqKey, messages: GROQ_VERIFY_MESSAGES },
} as const;

export function isAiProvider(v: unknown): v is AiProvider {
  return typeof v === "string" && (AI_PROVIDERS as readonly string[]).includes(v);
}

export type AiCredentialStatus =
  | {
      configured: false;
      /** Gemini only: a server-wide key exists in the environment (value never exposed). */
      envFallback: boolean;
    }
  | {
      configured: true;
      hint: string;
      model: string | null;
      lastVerifiedAt: string | null;
      updatedAt: string;
      updatedBy: string | null;
    };

type Row = {
  encrypted_key: string;
  key_hint: string;
  model: string | null;
  last_verified_at: Date | null;
  updated_at: Date;
  updated_by_email: string | null;
};

const SELECT = `SELECT c.encrypted_key, c.key_hint, c.model, c.last_verified_at, c.updated_at, u.email AS updated_by_email
    FROM organization_ai_credentials c LEFT JOIN users u ON u.id = c.updated_by
   WHERE c.organization_id = ? AND c.provider = ?`;

const context = (orgId: string, provider: AiProvider) => `org:${orgId}:${provider}`;

export function isSecretStorageConfigured(): boolean {
  return getEncryptionKey() !== null;
}

/** Status for the settings page (admin+). Never includes the key. */
export async function getAiCredentialStatus(
  session: ActiveSession,
  provider: AiProvider,
  db: Queryable = getPool(),
): Promise<AiCredentialStatus> {
  if (!hasRole(session.role, "admin")) throw new AuthorizationError("admin");
  const row = await queryOne<Row>(SELECT, [session.organization.id, provider], db);
  if (!row) return { configured: false, envFallback: provider === "gemini" && getAiConfig() !== null };
  return {
    configured: true,
    hint: row.key_hint,
    model: row.model,
    lastVerifiedAt: row.last_verified_at ? row.last_verified_at.toISOString() : null,
    updatedAt: row.updated_at.toISOString(),
    updatedBy: row.updated_by_email,
  };
}

/** Plaintext key for server-side AI calls (analyst+, who may ask the AI Analyst). */
export async function getAiApiKey(
  session: ActiveSession,
  provider: AiProvider,
  db: Queryable = getPool(),
): Promise<{ apiKey: string; model: string | null; source: "organization" | "environment" } | null> {
  if (!can(session.role, "ai:ask")) throw new AuthorizationError("analyst");
  const key = getEncryptionKey();
  const row = key ? await queryOne<Row>(SELECT, [session.organization.id, provider], db) : null;
  if (row && key) {
    return {
      apiKey: decryptSecret(row.encrypted_key, key, context(session.organization.id, provider)),
      model: row.model,
      source: "organization",
    };
  }
  if (provider === "gemini") {
    const env = getAiConfig();
    if (env) return { apiKey: env.apiKey, model: env.model ?? null, source: "environment" };
  }
  return null;
}

export const aiCredentialSchema = z.object({
  /** Empty = keep the stored key (e.g. only the model changes). */
  apiKey: z
    .string()
    .trim()
    .max(512, "API Key terlalu panjang.")
    .refine((v) => v === "" || /^[\x21-\x7e]{16,}$/.test(v), "API Key tidak valid (tanpa spasi, minimal 16 karakter)."),
  model: z
    .string()
    .trim()
    .max(128, "ID model terlalu panjang.")
    .refine((v) => v === "" || /^[A-Za-z0-9._:/-]+$/.test(v), "ID model tidak valid."),
});

export type SaveAiResult =
  | { ok: true; hint: string; models: string[] }
  | { ok: false; field?: "apiKey" | "model"; message: string; models?: string[] };

export async function saveAiCredential(
  session: ActiveSession,
  provider: AiProvider,
  input: z.output<typeof aiCredentialSchema>,
  { ipAddress = null, fetchImpl }: { ipAddress?: string | null; fetchImpl?: typeof fetch } = {},
): Promise<SaveAiResult> {
  if (!can(session.role, "organization:manage")) throw new AuthorizationError("owner");
  const encKey = getEncryptionKey();
  if (!encKey) return { ok: false, message: "APP_ENCRYPTION_KEY belum dikonfigurasi di server." };
  const org = session.organization.id;
  const label = AI_PROVIDER_LABELS[provider];

  const existing = await queryOne<Row>(SELECT, [org, provider]);
  let apiKey = input.apiKey;
  if (!apiKey) {
    if (!existing) return { ok: false, field: "apiKey", message: `Masukkan API Key ${label}.` };
    apiKey = decryptSecret(existing.encrypted_key, encKey, context(org, provider));
  }

  const { verify, messages } = VERIFY[provider];
  const verified = await verify(apiKey, { fetchImpl });
  if (!verified.ok) return { ok: false, field: "apiKey", message: messages[verified.reason] };
  const model = input.model || null;
  if (model && verified.models.length && !verified.models.includes(model)) {
    return {
      ok: false,
      field: "model",
      message: `Model "${model}" tidak tersedia untuk key ini.`,
      models: verified.models,
    };
  }

  const hint = secretHint(apiKey);
  const keyChanged = Boolean(input.apiKey);
  await withTransaction(async (conn) => {
    await execute(
      `INSERT INTO organization_ai_credentials
         (organization_id, provider, encrypted_key, key_hint, model, last_verified_at, updated_by)
       VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP(3), ?)
       ON DUPLICATE KEY UPDATE encrypted_key = VALUES(encrypted_key), key_hint = VALUES(key_hint),
         model = VALUES(model), last_verified_at = VALUES(last_verified_at), updated_by = VALUES(updated_by)`,
      [org, provider, encryptSecret(apiKey, encKey, context(org, provider)), hint, model, session.user.id],
      conn,
    );
    await writeAudit(conn, {
      organizationId: org,
      actorUserId: session.user.id,
      action: existing ? "ai_credential.updated" : "ai_credential.created",
      entityType: "ai_credential",
      entityId: provider,
      oldData: existing ? { provider, keyHint: existing.key_hint, model: existing.model } : undefined,
      newData: { provider, keyHint: hint, model, keyChanged },
      ipAddress,
    });
  });
  return { ok: true, hint, models: verified.models };
}

export async function removeAiCredential(
  session: ActiveSession,
  provider: AiProvider,
  ipAddress: string | null = null,
): Promise<boolean> {
  if (!can(session.role, "organization:manage")) throw new AuthorizationError("owner");
  const org = session.organization.id;
  return withTransaction(async (conn) => {
    const existing = await queryOne<Row>(SELECT, [org, provider], conn);
    if (!existing) return false;
    await execute(
      "DELETE FROM organization_ai_credentials WHERE organization_id = ? AND provider = ?",
      [org, provider],
      conn,
    );
    await writeAudit(conn, {
      organizationId: org,
      actorUserId: session.user.id,
      action: "ai_credential.removed",
      entityType: "ai_credential",
      entityId: provider,
      oldData: { provider, keyHint: existing.key_hint, model: existing.model },
      ipAddress,
    });
    return true;
  });
}
