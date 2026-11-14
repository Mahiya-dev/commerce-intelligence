import type { PoolConnection } from "mysql2/promise";
import { execute, queryOne, queryRows, withTransaction } from "@/lib/db/pool";
import { writeAudit } from "@/lib/audit";
import { DEMO_ORG_SLUG, DEMO_USERS } from "@/lib/master-data/demo-seed";

/**
 * Removes the DEMO organization and everything that belongs to it (sales,
 * imports, portfolio, creative, events, affiliates, settings, audit trail),
 * plus the demo accounts (*.demo@uray.local) once they belong to no
 * organization. One transaction: all or nothing.
 *
 * Safety: only an organization flagged is_demo = 1 can be removed, and the
 * caller must pass its slug explicitly. Real organizations are never touched;
 * reference tables (channels) are kept.
 *
 * Every organization-scoped table is found from information_schema (column
 * organization_id), so tables added by later migrations are covered too.
 * Foreign key checks are relaxed for the session only while rows of this one
 * organization are deleted (its rows reference each other with RESTRICT FKs);
 * composite FKs include organization_id, so no other organization can point at them.
 */

export class DemoRemovalRefused extends Error {}

export type DemoRemovalResult =
  | { status: "not_found" }
  | { status: "removed"; organizationId: string; rows: Record<string, number>; users: string[] };

const SAFE_IDENT = /^[a-z][a-z0-9_]{0,63}$/;

async function orgScopedTables(conn: PoolConnection): Promise<string[]> {
  const rows = await queryRows<{ t: string }>(
    `SELECT c.TABLE_NAME AS t
       FROM information_schema.COLUMNS c
       JOIN information_schema.TABLES t ON t.TABLE_SCHEMA = c.TABLE_SCHEMA AND t.TABLE_NAME = c.TABLE_NAME
      WHERE c.TABLE_SCHEMA = DATABASE() AND c.COLUMN_NAME = 'organization_id'
        AND t.TABLE_TYPE = 'BASE TABLE' AND c.TABLE_NAME <> 'organizations'
      ORDER BY c.TABLE_NAME`,
    [],
    conn,
  );
  return rows.map((r) => r.t).filter((t) => SAFE_IDENT.test(t));
}

export async function removeDemoData({ confirmSlug }: { confirmSlug: string }): Promise<DemoRemovalResult> {
  if (confirmSlug !== DEMO_ORG_SLUG) {
    throw new DemoRemovalRefused(`Konfirmasi tidak cocok: gunakan --confirm ${DEMO_ORG_SLUG}.`);
  }
  return withTransaction(async (conn) => {
    const org = await queryOne<{ id: string; is_demo: number }>(
      "SELECT id, is_demo FROM organizations WHERE slug = ? FOR UPDATE",
      [DEMO_ORG_SLUG],
      conn,
    );
    if (!org) return { status: "not_found" };
    if (Number(org.is_demo) !== 1) {
      throw new DemoRemovalRefused(`Organisasi '${DEMO_ORG_SLUG}' tidak bertanda DEMO; dibatalkan.`);
    }

    const rows: Record<string, number> = {};
    await conn.query("SET FOREIGN_KEY_CHECKS = 0");
    try {
      for (const table of await orgScopedTables(conn)) {
        const res = await execute(`DELETE FROM \`${table}\` WHERE organization_id = ?`, [org.id], conn);
        if (res.affectedRows) rows[table] = res.affectedRows;
      }
      await execute("DELETE FROM organizations WHERE id = ?", [org.id], conn);
    } finally {
      await conn.query("SET FOREIGN_KEY_CHECKS = 1");
    }

    // Demo accounts without any remaining membership (FK checks on: sessions cascade, created_by → NULL).
    const emails = DEMO_USERS.map((u) => u.email);
    const orphans = await queryRows<{ id: string; email: string }>(
      `SELECT u.id, u.email FROM users u
        WHERE u.email IN (${emails.map(() => "?").join(", ")})
          AND NOT EXISTS (SELECT 1 FROM organization_members m WHERE m.user_id = u.id)`,
      emails,
      conn,
    );
    for (const u of orphans) await execute("DELETE FROM users WHERE id = ?", [u.id], conn);

    await writeAudit(conn, {
      organizationId: null,
      actorUserId: null,
      action: "demo.removed",
      entityType: "organization",
      entityId: org.id,
      newData: { slug: DEMO_ORG_SLUG, rows, users: orphans.map((u) => u.email) },
    });
    return { status: "removed", organizationId: org.id, rows, users: orphans.map((u) => u.email) };
  });
}
