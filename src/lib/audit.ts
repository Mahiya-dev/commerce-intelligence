import { execute, type Queryable } from "@/lib/db/pool";

export type AuditEntry = {
  organizationId: string | null;
  actorUserId: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  oldData?: unknown;
  newData?: unknown;
  ipAddress?: string | null;
};

/** Never store secrets in audit payloads. */
const REDACTED_KEYS = new Set(["password", "password_hash", "token", "session", "secret"]);

function redact(value: unknown): unknown {
  if (value === null || value === undefined) return value ?? null;
  if (Array.isArray(value)) return value.map(redact);
  if (typeof value === "object" && !(value instanceof Date)) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [
        k,
        REDACTED_KEYS.has(k) ? "[REDACTED]" : redact(v),
      ]),
    );
  }
  return value;
}

/**
 * Append an audit record. Pass the transaction connection so the audit row
 * commits (or rolls back) together with the change it describes.
 */
export async function writeAudit(db: Queryable, entry: AuditEntry): Promise<void> {
  await execute(
    `INSERT INTO audit_logs (organization_id, actor_user_id, action, entity_type, entity_id, old_data, new_data, ip_address)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      entry.organizationId,
      entry.actorUserId,
      entry.action,
      entry.entityType,
      entry.entityId ?? null,
      entry.oldData === undefined ? null : JSON.stringify(redact(entry.oldData)),
      entry.newData === undefined ? null : JSON.stringify(redact(entry.newData)),
      entry.ipAddress ?? null,
    ],
    db,
  );
}
