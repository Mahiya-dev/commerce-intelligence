import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { PoolConnection } from "mysql2/promise";
import { execute, queryOne, withTransaction } from "@/lib/db/pool";
import { writeAudit } from "@/lib/audit";
import { can, type Permission } from "@/lib/auth/roles";
import type { ActiveSession } from "@/lib/auth/sessions";
import { AuthorizationError } from "@/lib/data/master-data";
import { isIsoDate } from "@/lib/ecommerce/date-range";

/**
 * HSL allocation workflow and stock ledger.
 *   proposed  (analyst, "allocations:propose")
 *   approved  (admin, "allocations:approve")  quantity may be edited; ≤ free stock
 *   applied   (admin)                         stock re-checked under a row lock, ledger entry written
 * Stock movements: admin ("inventory:manage"). Every change is audited.
 * Concurrency: the SKU's product_variants row is locked (SELECT … FOR UPDATE)
 * as a mutex before stock is checked, so two applies cannot both pass.
 */

function assertCan(session: ActiveSession, permission: Permission, role: "analyst" | "admin") {
  if (!can(session.role, permission)) throw new AuthorizationError(role);
}

type Conn = PoolConnection;

const WAREHOUSE_SQL = `SELECT COALESCE(SUM(CASE movement_type
           WHEN 'masuk' THEN quantity
           WHEN 'penyesuaian' THEN quantity * sign_adjust
           WHEN 'alokasi' THEN -quantity
           WHEN 'retur' THEN quantity END), 0) AS q
      FROM inventory_movements WHERE organization_id = ? AND variant_id = ?`;

/** Locks the SKU (mutex) and returns warehouse stock and stock reserved by approved allocations. */
async function lockStock(conn: Conn, org: string, variantId: string) {
  await queryOne(
    "SELECT id FROM product_variants WHERE organization_id = ? AND id = ? FOR UPDATE",
    [org, variantId],
    conn,
  );
  const [stock, reserved] = await Promise.all([
    queryOne<{ q: string | number }>(WAREHOUSE_SQL, [org, variantId], conn),
    queryOne<{ q: string | number | null }>(
      `SELECT SUM(approved_qty) AS q FROM hsl_allocations
        WHERE organization_id = ? AND variant_id = ? AND status = 'disetujui'`,
      [org, variantId],
      conn,
    ),
  ]);
  return { warehouse: Number(stock?.q ?? 0), reserved: Number(reserved?.q ?? 0) };
}

/** Units currently consigned to an affiliate (allocated − returned − sold). */
async function lockedWithAffiliate(conn: Conn, org: string, affiliateId: string, variantId: string) {
  const [moves, sold] = await Promise.all([
    queryOne<{ q: string | number }>(
      `SELECT COALESCE(SUM(CASE movement_type WHEN 'alokasi' THEN quantity WHEN 'retur' THEN -quantity ELSE 0 END), 0) AS q
         FROM inventory_movements WHERE organization_id = ? AND affiliate_id = ? AND variant_id = ?`,
      [org, affiliateId, variantId],
      conn,
    ),
    queryOne<{ q: string | number | null }>(
      `SELECT SUM(f.units_sold * l.units_per_listing) AS q
         FROM hsl_sales_facts f
         JOIN channel_listings l ON l.organization_id = f.organization_id AND l.id = f.listing_id
        WHERE f.organization_id = ? AND f.affiliate_id = ? AND l.variant_id = ?`,
      [org, affiliateId, variantId],
      conn,
    ),
  ]);
  return Math.max(0, Number(moves?.q ?? 0) - Number(sold?.q ?? 0));
}

// ---- proposals --------------------------------------------------------------------

export type ProposalInput = {
  affiliateId: string;
  sku: string;
  quantity: number;
  basis: Record<string, number | boolean>;
};

/** Saves recommendations as proposals; an open proposal for the same affiliate × SKU is updated. */
export async function proposeAllocations(
  session: ActiveSession,
  proposals: ProposalInput[],
  { ipAddress = null, isDemo }: { ipAddress?: string | null; isDemo?: boolean } = {},
): Promise<number> {
  assertCan(session, "allocations:propose", "analyst");
  const org = session.organization.id;
  return withTransaction(async (conn) => {
    let saved = 0;
    for (const p of proposals.filter((x) => x.quantity > 0)) {
      const v = await queryOne<{ id: string }>(
        "SELECT id FROM product_variants WHERE organization_id = ? AND sku = ?",
        [org, p.sku],
        conn,
      );
      const a = await queryOne<{ id: string }>(
        "SELECT id FROM affiliates WHERE organization_id = ? AND id = ?",
        [org, p.affiliateId],
        conn,
      );
      if (!v || !a) continue;
      const open = await queryOne<{ id: string }>(
        `SELECT id FROM hsl_allocations
          WHERE organization_id = ? AND affiliate_id = ? AND variant_id = ? AND status = 'diusulkan' FOR UPDATE`,
        [org, a.id, v.id],
        conn,
      );
      if (open) {
        await execute(
          `UPDATE hsl_allocations SET proposed_qty = ?, basis = ?, proposed_by = ?, proposed_at = CURRENT_TIMESTAMP(3)
            WHERE organization_id = ? AND id = ?`,
          [p.quantity, JSON.stringify(p.basis), session.user.id, org, open.id],
          conn,
        );
      } else {
        await execute(
          `INSERT INTO hsl_allocations (id, organization_id, affiliate_id, variant_id, proposed_qty, basis, proposed_by, is_demo)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            randomUUID(),
            org,
            a.id,
            v.id,
            p.quantity,
            JSON.stringify(p.basis),
            session.user.id,
            (isDemo ?? session.organization.isDemo) ? 1 : 0,
          ],
          conn,
        );
      }
      saved++;
    }
    await writeAudit(conn, {
      organizationId: org,
      actorUserId: session.user.id,
      action: "allocation.proposed",
      entityType: "hsl_allocation",
      newData: {
        count: saved,
        proposals: proposals.map((p) => ({ affiliateId: p.affiliateId, sku: p.sku, quantity: p.quantity })),
      },
      ipAddress,
    });
    return saved;
  });
}

export type DecisionResult = { ok: true } | { ok: false; message: string };

export async function approveAllocation(
  session: ActiveSession,
  id: string,
  quantity: number,
  { ipAddress = null }: { ipAddress?: string | null } = {},
): Promise<DecisionResult> {
  assertCan(session, "allocations:approve", "admin");
  if (!Number.isSafeInteger(quantity) || quantity <= 0)
    return { ok: false, message: "Jumlah harus bilangan bulat > 0." };
  const org = session.organization.id;
  return withTransaction(async (conn) => {
    const al = await queryOne<{ variant_id: string; status: string; proposed_qty: number }>(
      "SELECT variant_id, status, proposed_qty FROM hsl_allocations WHERE organization_id = ? AND id = ? FOR UPDATE",
      [org, id],
      conn,
    );
    if (!al) return { ok: false, message: "Usulan tidak ditemukan." };
    if (al.status !== "diusulkan") return { ok: false, message: "Usulan ini sudah diputuskan." };
    const { warehouse, reserved } = await lockStock(conn, org, al.variant_id);
    const free = warehouse - reserved;
    if (quantity > free) {
      return {
        ok: false,
        message: `Melebihi stok gudang yang tersedia (${Math.max(0, free)} unit setelah alokasi yang sudah disetujui).`,
      };
    }
    await execute(
      `UPDATE hsl_allocations SET status = 'disetujui', approved_qty = ?, decided_by = ?, decided_at = CURRENT_TIMESTAMP(3)
        WHERE organization_id = ? AND id = ?`,
      [quantity, session.user.id, org, id],
      conn,
    );
    await writeAudit(conn, {
      organizationId: org,
      actorUserId: session.user.id,
      action: "allocation.approved",
      entityType: "hsl_allocation",
      entityId: id,
      oldData: { proposedQty: al.proposed_qty },
      newData: { approvedQty: quantity, warehouse, reserved },
      ipAddress,
    });
    return { ok: true };
  });
}

export async function rejectAllocation(
  session: ActiveSession,
  id: string,
  { ipAddress = null }: { ipAddress?: string | null } = {},
) {
  assertCan(session, "allocations:approve", "admin");
  const org = session.organization.id;
  return withTransaction(async (conn) => {
    const res = await execute(
      `UPDATE hsl_allocations SET status = 'ditolak', decided_by = ?, decided_at = CURRENT_TIMESTAMP(3)
        WHERE organization_id = ? AND id = ? AND status IN ('diusulkan', 'disetujui')`,
      [session.user.id, org, id],
      conn,
    );
    if (res.affectedRows === 0) return false;
    await writeAudit(conn, {
      organizationId: org,
      actorUserId: session.user.id,
      action: "allocation.rejected",
      entityType: "hsl_allocation",
      entityId: id,
      ipAddress,
    });
    return true;
  });
}

/** Moves the approved quantity from the warehouse to the affiliate. Never exceeds stock. */
export async function applyAllocation(
  session: ActiveSession,
  id: string,
  { ipAddress = null, occurredOn }: { ipAddress?: string | null; occurredOn?: string } = {},
): Promise<DecisionResult> {
  assertCan(session, "allocations:approve", "admin");
  const org = session.organization.id;
  return withTransaction(async (conn) => {
    const al = await queryOne<{
      affiliate_id: string;
      variant_id: string;
      status: string;
      approved_qty: number | null;
      is_demo: number;
    }>(
      "SELECT affiliate_id, variant_id, status, approved_qty, is_demo FROM hsl_allocations WHERE organization_id = ? AND id = ? FOR UPDATE",
      [org, id],
      conn,
    );
    if (!al) return { ok: false, message: "Alokasi tidak ditemukan." };
    if (al.status !== "disetujui" || !al.approved_qty)
      return { ok: false, message: "Hanya alokasi yang sudah disetujui yang bisa diterapkan." };
    const { warehouse } = await lockStock(conn, org, al.variant_id);
    if (al.approved_qty > warehouse) {
      return { ok: false, message: `Stok gudang tidak cukup (${warehouse} unit). Kurangi jumlah atau tambah stok.` };
    }
    await execute(
      `INSERT INTO inventory_movements
         (organization_id, variant_id, affiliate_id, movement_type, quantity, occurred_on, allocation_id, created_by, is_demo)
       VALUES (?, ?, ?, 'alokasi', ?, COALESCE(?, CURRENT_DATE), ?, ?, ?)`,
      [org, al.variant_id, al.affiliate_id, al.approved_qty, occurredOn ?? null, id, session.user.id, al.is_demo],
      conn,
    );
    await execute(
      `UPDATE hsl_allocations SET status = 'diterapkan', applied_by = ?, applied_at = CURRENT_TIMESTAMP(3)
        WHERE organization_id = ? AND id = ?`,
      [session.user.id, org, id],
      conn,
    );
    await writeAudit(conn, {
      organizationId: org,
      actorUserId: session.user.id,
      action: "allocation.applied",
      entityType: "hsl_allocation",
      entityId: id,
      newData: { quantity: al.approved_qty, warehouseBefore: warehouse },
      ipAddress,
    });
    return { ok: true };
  });
}

// ---- stock movements ---------------------------------------------------------------

export const movementSchema = z
  .object({
    sku: z.string().trim().min(1, "Pilih SKU."),
    type: z.enum(["masuk", "penyesuaian_tambah", "penyesuaian_kurang", "retur"], { message: "Pilih jenis." }),
    quantity: z.coerce.number().int("Bilangan bulat.").min(1, "Minimal 1."),
    affiliateId: z.string().trim(),
    occurredOn: z.string().trim().refine(isIsoDate, "Tanggal tidak valid."),
    note: z
      .string()
      .trim()
      .max(255)
      .transform((v) => (v === "" ? null : v)),
  })
  .refine((v) => v.type !== "retur" || v.affiliateId !== "", {
    message: "Pilih afiliasi untuk retur.",
    path: ["affiliateId"],
  });

export async function recordMovement(
  session: ActiveSession,
  input: z.output<typeof movementSchema>,
  { ipAddress = null, isDemo }: { ipAddress?: string | null; isDemo?: boolean } = {},
): Promise<DecisionResult> {
  assertCan(session, "inventory:manage", "admin");
  const org = session.organization.id;
  return withTransaction(async (conn) => {
    const v = await queryOne<{ id: string }>(
      "SELECT id FROM product_variants WHERE organization_id = ? AND sku = ?",
      [org, input.sku],
      conn,
    );
    if (!v) return { ok: false, message: `SKU '${input.sku}' tidak ada.` };
    const { warehouse } = await lockStock(conn, org, v.id);
    let affiliateId: string | null = null;
    if (input.type === "retur") {
      const a = await queryOne<{ id: string }>(
        "SELECT id FROM affiliates WHERE organization_id = ? AND id = ?",
        [org, input.affiliateId],
        conn,
      );
      if (!a) return { ok: false, message: "Afiliasi tidak ditemukan." };
      affiliateId = a.id;
      const locked = await lockedWithAffiliate(conn, org, a.id, v.id);
      if (input.quantity > locked) return { ok: false, message: `Retur melebihi stok di afiliasi (${locked} unit).` };
    }
    if (input.type === "penyesuaian_kurang" && input.quantity > warehouse) {
      return { ok: false, message: `Stok gudang hanya ${warehouse} unit.` };
    }
    const type = input.type.startsWith("penyesuaian") ? "penyesuaian" : input.type;
    await execute(
      `INSERT INTO inventory_movements
         (organization_id, variant_id, affiliate_id, movement_type, quantity, sign_adjust, occurred_on, note, created_by, is_demo)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        org,
        v.id,
        affiliateId,
        type,
        input.quantity,
        input.type === "penyesuaian_kurang" ? -1 : 1,
        input.occurredOn,
        input.note,
        session.user.id,
        (isDemo ?? session.organization.isDemo) ? 1 : 0,
      ],
      conn,
    );
    await writeAudit(conn, {
      organizationId: org,
      actorUserId: session.user.id,
      action: "inventory.movement_recorded",
      entityType: "product_variant",
      entityId: v.id,
      newData: input,
      ipAddress,
    });
    return { ok: true };
  });
}

export const affiliateSchema = z.object({
  name: z.string().trim().min(2, "Nama minimal 2 karakter.").max(200),
  status: z.enum(["aktif", "nonaktif"]),
  notes: z
    .string()
    .trim()
    .max(1000)
    .transform((v) => (v === "" ? null : v)),
});

export async function updateAffiliate(
  session: ActiveSession,
  id: string,
  input: z.output<typeof affiliateSchema>,
  { ipAddress = null }: { ipAddress?: string | null } = {},
) {
  assertCan(session, "allocations:propose", "analyst");
  const org = session.organization.id;
  return withTransaction(async (conn) => {
    const res = await execute(
      "UPDATE affiliates SET name = ?, status = ?, notes = ? WHERE organization_id = ? AND id = ?",
      [input.name, input.status, input.notes, org, id],
      conn,
    );
    if (res.affectedRows === 0) return false;
    await writeAudit(conn, {
      organizationId: org,
      actorUserId: session.user.id,
      action: "affiliate.updated",
      entityType: "affiliate",
      entityId: id,
      newData: input,
      ipAddress,
    });
    return true;
  });
}
