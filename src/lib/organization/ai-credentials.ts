import { z } from "zod";
import { execute, getPool, queryOne, withTransaction, type Queryable } from "@/lib/db/pool";
import { writeAudit } from "@/lib/audit";
import { can, hasRole } from "@/lib/auth/roles";
import type { ActiveSession } from "@/lib/auth/sessions";
import { AuthorizationError } from "@/lib/data/master-data";
import { getEncryptionKey } from "@/lib/env";
import { decryptSecret, encryptSecret, secretHint } from "@/lib/crypto/secret-box";
import { GROQ_VERIFY_MESSAGES, verifyGroqKey } from "@/lib/ai/groq";

/**
 * AI provider credentials per organization (migration 0008). Only the Owner
 * ("organization:manage") can set or remove a key. The key is encrypted with
 * APP_ENCRYPTION_KEY; reads for display return a hint only. The plaintext key
 * is available server-side via getGroqApiKey() for the AI Analyst.
 * Audit entries never contain the key.
 */

export type AiCredentialStatus =
  | { configured: false }
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
   WHERE c.organization_id = ? AND c.provider = 'groq'`;

const context = (orgId: string) => `org:${orgId}:groq`;

export function isSecretStorageConfigured(): boolean {
  return getEncryptionKey() !== null;
}

/** Status for the settings page (admin+). Never includes the key. */
export async function getGroqCredentialStatus(
  session: ActiveSession,
  db: Queryable = getPool(),
): Promise<AiCredentialStatus> {
  if (!hasRole(session.role, "admin")) throw new AuthorizationError("admin");
  const row = await queryOne<Row>(SELECT, [session.organization.id], db);
  if (!row) return { configured: false };
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
export async function getGroqApiKey(
  session: ActiveSession,
  db: Queryable = getPool(),
): Promise<{ apiKey: string; model: string | null } | null> {
  if (!can(session.role, "ai:ask")) throw new AuthorizationError("analyst");
  const key = getEncryptionKey();
  if (!key) return null;
  const row = await queryOne<Row>(SELECT, [session.organization.id], db);
  if (!row) return null;
  return { apiKey: decryptSecret(row.encrypted_key, key, context(session.organization.id)), model: row.model };
}

export const groqCredentialSchema = z.object({
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

export type SaveGroqResult =
  | { ok: true; hint: string; models: string[] }
  | { ok: false; field?: "apiKey" | "model"; message: string; models?: string[] };

export async function saveGroqCredential(
  session: ActiveSession,
  input: z.output<typeof groqCredentialSchema>,
  { ipAddress = null, fetchImpl }: { ipAddress?: string | null; fetchImpl?: typeof fetch } = {},
): Promise<SaveGroqResult> {
  if (!can(session.role, "organization:manage")) throw new AuthorizationError("owner");
  const encKey = getEncryptionKey();
  if (!encKey) return { ok: false, message: "APP_ENCRYPTION_KEY belum dikonfigurasi di server." };
  const org = session.organization.id;

  const existing = await queryOne<Row>(SELECT, [org]);
  let apiKey = input.apiKey;
  if (!apiKey) {
    if (!existing) return { ok: false, field: "apiKey", message: "Masukkan API Key Groq." };
    apiKey = decryptSecret(existing.encrypted_key, encKey, context(org));
  }

  const verified = await verifyGroqKey(apiKey, { fetchImpl });
  if (!verified.ok) return { ok: false, field: "apiKey", message: GROQ_VERIFY_MESSAGES[verified.reason] };
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
       VALUES (?, 'groq', ?, ?, ?, CURRENT_TIMESTAMP(3), ?)
       ON DUPLICATE KEY UPDATE encrypted_key = VALUES(encrypted_key), key_hint = VALUES(key_hint),
         model = VALUES(model), last_verified_at = VALUES(last_verified_at), updated_by = VALUES(updated_by)`,
      [org, encryptSecret(apiKey, encKey, context(org)), hint, model, session.user.id],
      conn,
    );
    await writeAudit(conn, {
      organizationId: org,
      actorUserId: session.user.id,
      action: existing ? "ai_credential.updated" : "ai_credential.created",
      entityType: "ai_credential",
      entityId: "groq",
      oldData: existing ? { provider: "groq", keyHint: existing.key_hint, model: existing.model } : undefined,
      newData: { provider: "groq", keyHint: hint, model, keyChanged },
      ipAddress,
    });
  });
  return { ok: true, hint, models: verified.models };
}

export async function removeGroqCredential(session: ActiveSession, ipAddress: string | null = null): Promise<boolean> {
  if (!can(session.role, "organization:manage")) throw new AuthorizationError("owner");
  const org = session.organization.id;
  return withTransaction(async (conn) => {
    const existing = await queryOne<Row>(SELECT, [org], conn);
    if (!existing) return false;
    await execute(
      "DELETE FROM organization_ai_credentials WHERE organization_id = ? AND provider = 'groq'",
      [org],
      conn,
    );
    await writeAudit(conn, {
      organizationId: org,
      actorUserId: session.user.id,
      action: "ai_credential.removed",
      entityType: "ai_credential",
      entityId: "groq",
      oldData: { provider: "groq", keyHint: existing.key_hint, model: existing.model },
      ipAddress,
    });
    return true;
  });
}
