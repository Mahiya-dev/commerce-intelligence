import { randomUUID } from "node:crypto";
import { z } from "zod";
import { execute, queryOne, withTransaction } from "@/lib/db/pool";
import { writeAudit } from "@/lib/audit";
import { can, type Permission } from "@/lib/auth/roles";
import type { ActiveSession } from "@/lib/auth/sessions";
import { AuthorizationError } from "@/lib/data/master-data";
import { isIsoDate } from "@/lib/ecommerce/date-range";

/**
 * Event mutations ("events:manage", analyst+) and versioned COGS
 * ("master_data:manage", admin+). Every change is audited in the same
 * transaction; every query is scoped to the caller's organization.
 */

export const EVENT_KINDS = ["bazar", "pameran", "sponsorship", "pop_up", "online", "lainnya"] as const;
export const EVENT_STATUSES = ["rencana", "berlangsung", "selesai", "batal"] as const;
export const COST_CATEGORIES = [
  "sewa_booth",
  "transport",
  "akomodasi",
  "tenaga_kerja",
  "konsumsi",
  "promosi",
  "sampel",
  "perlengkapan",
  "lainnya",
] as const;
export const LEAD_SOURCES = ["form", "qr", "whatsapp", "kartu_nama", "lainnya"] as const;

export const EVENT_KIND_LABELS: Record<(typeof EVENT_KINDS)[number], string> = {
  bazar: "Bazar",
  pameran: "Pameran",
  sponsorship: "Sponsorship",
  pop_up: "Pop-up store",
  online: "Online",
  lainnya: "Lainnya",
};
export const EVENT_STATUS_LABELS: Record<(typeof EVENT_STATUSES)[number], string> = {
  rencana: "Rencana",
  berlangsung: "Berlangsung",
  selesai: "Selesai",
  batal: "Batal",
};
export const COST_CATEGORY_LABELS: Record<(typeof COST_CATEGORIES)[number], string> = {
  sewa_booth: "Sewa booth",
  transport: "Transport",
  akomodasi: "Akomodasi",
  tenaga_kerja: "Tenaga kerja / SPG",
  konsumsi: "Konsumsi",
  promosi: "Promosi",
  sampel: "Sampel gratis",
  perlengkapan: "Perlengkapan",
  lainnya: "Lainnya",
};
export const LEAD_SOURCE_LABELS: Record<(typeof LEAD_SOURCES)[number], string> = {
  form: "Formulir",
  qr: "Kode QR",
  whatsapp: "WhatsApp",
  kartu_nama: "Kartu nama",
  lainnya: "Lainnya",
};

function assertCan(session: ActiveSession, permission: Permission, role: "analyst" | "admin") {
  if (!can(session.role, permission)) throw new AuthorizationError(role);
}

const date = (label: string) => z.string().trim().refine(isIsoDate, `${label} tidak valid (YYYY-MM-DD).`);
/** Whole rupiah / counts; allows thousands separators ("1.500.000"). */
const integer = (label: string, min: number) =>
  z
    .string()
    .trim()
    .transform((v, ctx) => {
      const digits = v.replace(/^rp\s*/i, "").replace(/[.\s]/g, "");
      if (!/^\d+$/.test(digits) || !Number.isSafeInteger(Number(digits))) {
        ctx.addIssue({ code: "custom", message: `${label} harus bilangan bulat.` });
        return z.NEVER;
      }
      if (Number(digits) < min) {
        ctx.addIssue({ code: "custom", message: `${label} minimal ${min}.` });
        return z.NEVER;
      }
      return Number(digits);
    });
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Maksimal ${max} karakter.`)
    .transform((v) => (v === "" ? null : v));

export const eventSchema = z
  .object({
    name: z.string().trim().min(3, "Nama minimal 3 karakter.").max(200),
    kind: z.enum(EVENT_KINDS, { message: "Pilih jenis event." }),
    location: optionalText(200),
    startDate: date("Tanggal mulai"),
    endDate: date("Tanggal selesai"),
    status: z.enum(EVENT_STATUSES, { message: "Pilih status." }),
    attributionDays: integer("Masa atribusi", 0).refine((v) => v <= 180, "Masa atribusi maksimal 180 hari."),
    notes: optionalText(1000),
  })
  .refine((v) => v.startDate <= v.endDate, { message: "Tanggal selesai sebelum tanggal mulai.", path: ["endDate"] });

export const saleSchema = z.object({
  sku: z.string().trim().min(1, "Pilih SKU."),
  soldOn: date("Tanggal"),
  units: integer("Unit", 1),
  revenue: integer("Pendapatan", 0),
  phase: z.enum(["event", "pasca_event"], { message: "Pilih fase." }),
  note: optionalText(255),
});

export const costSchema = z.object({
  category: z.enum(COST_CATEGORIES, { message: "Pilih kategori." }),
  costType: z.enum(["tetap", "variabel"], { message: "Pilih jenis biaya." }),
  amount: integer("Jumlah", 1),
  incurredOn: z
    .string()
    .trim()
    .transform((v) => (v === "" ? null : v))
    .refine((v) => v === null || isIsoDate(v), "Tanggal tidak valid."),
  note: optionalText(255),
});

export const leadSchema = z
  .object({
    capturedOn: date("Tanggal"),
    source: z.enum(LEAD_SOURCES, { message: "Pilih sumber." }),
    leads: integer("Jumlah lead", 1),
    converted: integer("Jumlah konversi", 0),
    note: optionalText(255),
  })
  .refine((v) => v.converted <= v.leads, {
    message: "Konversi tidak boleh melebihi jumlah lead.",
    path: ["converted"],
  });

export const cogsSchema = z.object({
  sku: z.string().trim().min(1, "Pilih SKU."),
  effectiveFrom: date("Berlaku mulai"),
  unitCogs: integer("COGS per unit", 0),
  note: optionalText(255),
});

type Ctx = { ipAddress?: string | null };

async function variantBySku(conn: Parameters<Parameters<typeof withTransaction>[0]>[0], org: string, sku: string) {
  return queryOne<{ id: string }>(
    "SELECT id FROM product_variants WHERE organization_id = ? AND sku = ?",
    [org, sku],
    conn,
  );
}

async function eventExists(conn: Parameters<Parameters<typeof withTransaction>[0]>[0], org: string, id: string) {
  return Boolean(
    await queryOne("SELECT id FROM events WHERE organization_id = ? AND id = ? FOR UPDATE", [org, id], conn),
  );
}

export async function saveEvent(
  session: ActiveSession,
  input: z.output<typeof eventSchema>,
  { id, ipAddress = null, isDemo }: Ctx & { id?: string; isDemo?: boolean } = {},
): Promise<{ ok: true; id: string } | { ok: false }> {
  assertCan(session, "events:manage", "analyst");
  const org = session.organization.id;
  return withTransaction(async (conn) => {
    const eventId = id ?? randomUUID();
    if (id) {
      const res = await execute(
        `UPDATE events SET name = ?, kind = ?, location = ?, start_date = ?, end_date = ?, status = ?,
                attribution_days = ?, notes = ?
          WHERE organization_id = ? AND id = ?`,
        [
          input.name,
          input.kind,
          input.location,
          input.startDate,
          input.endDate,
          input.status,
          input.attributionDays,
          input.notes,
          org,
          id,
        ],
        conn,
      );
      if (res.affectedRows === 0) return { ok: false };
    } else {
      await execute(
        `INSERT INTO events (id, organization_id, name, kind, location, start_date, end_date, status, attribution_days,
                             notes, is_demo, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          eventId,
          org,
          input.name,
          input.kind,
          input.location,
          input.startDate,
          input.endDate,
          input.status,
          input.attributionDays,
          input.notes,
          (isDemo ?? session.organization.isDemo) ? 1 : 0,
          session.user.id,
        ],
        conn,
      );
    }
    await writeAudit(conn, {
      organizationId: org,
      actorUserId: session.user.id,
      action: id ? "event.updated" : "event.created",
      entityType: "event",
      entityId: eventId,
      newData: input,
      ipAddress,
    });
    return { ok: true, id: eventId };
  });
}

export async function deleteEvent(session: ActiveSession, id: string, { ipAddress = null }: Ctx = {}) {
  assertCan(session, "events:manage", "analyst");
  const org = session.organization.id;
  return withTransaction(async (conn) => {
    const ev = await queryOne<{ name: string }>(
      "SELECT name FROM events WHERE organization_id = ? AND id = ? FOR UPDATE",
      [org, id],
      conn,
    );
    if (!ev) return false;
    await execute("DELETE FROM events WHERE organization_id = ? AND id = ?", [org, id], conn);
    await writeAudit(conn, {
      organizationId: org,
      actorUserId: session.user.id,
      action: "event.deleted",
      entityType: "event",
      entityId: id,
      oldData: ev,
      ipAddress,
    });
    return true;
  });
}

export type AddResult = { ok: true } | { ok: false; field: string; message: string };

export async function addSale(
  session: ActiveSession,
  eventId: string,
  input: z.output<typeof saleSchema>,
  { ipAddress = null }: Ctx = {},
): Promise<AddResult> {
  assertCan(session, "events:manage", "analyst");
  const org = session.organization.id;
  return withTransaction(async (conn) => {
    if (!(await eventExists(conn, org, eventId)))
      return { ok: false, field: "event", message: "Event tidak ditemukan." };
    const v = await variantBySku(conn, org, input.sku);
    if (!v) return { ok: false, field: "sku", message: `SKU '${input.sku}' tidak ada di Master Produk.` };
    await execute(
      `INSERT INTO event_sales (organization_id, event_id, variant_id, sold_on, units, revenue, phase, note, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [org, eventId, v.id, input.soldOn, input.units, input.revenue, input.phase, input.note, session.user.id],
      conn,
    );
    await writeAudit(conn, {
      organizationId: org,
      actorUserId: session.user.id,
      action: "event.sale_added",
      entityType: "event",
      entityId: eventId,
      newData: input,
      ipAddress,
    });
    return { ok: true };
  });
}

export async function addCost(
  session: ActiveSession,
  eventId: string,
  input: z.output<typeof costSchema>,
  { ipAddress = null }: Ctx = {},
): Promise<AddResult> {
  assertCan(session, "events:manage", "analyst");
  const org = session.organization.id;
  return withTransaction(async (conn) => {
    if (!(await eventExists(conn, org, eventId)))
      return { ok: false, field: "event", message: "Event tidak ditemukan." };
    await execute(
      `INSERT INTO event_costs (organization_id, event_id, category, cost_type, amount, incurred_on, note, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [org, eventId, input.category, input.costType, input.amount, input.incurredOn, input.note, session.user.id],
      conn,
    );
    await writeAudit(conn, {
      organizationId: org,
      actorUserId: session.user.id,
      action: "event.cost_added",
      entityType: "event",
      entityId: eventId,
      newData: input,
      ipAddress,
    });
    return { ok: true };
  });
}

export async function addLead(
  session: ActiveSession,
  eventId: string,
  input: z.output<typeof leadSchema>,
  { ipAddress = null }: Ctx = {},
): Promise<AddResult> {
  assertCan(session, "events:manage", "analyst");
  const org = session.organization.id;
  return withTransaction(async (conn) => {
    if (!(await eventExists(conn, org, eventId)))
      return { ok: false, field: "event", message: "Event tidak ditemukan." };
    await execute(
      `INSERT INTO event_leads (organization_id, event_id, captured_on, source, leads, converted, note, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [org, eventId, input.capturedOn, input.source, input.leads, input.converted, input.note, session.user.id],
      conn,
    );
    await writeAudit(conn, {
      organizationId: org,
      actorUserId: session.user.id,
      action: "event.lead_added",
      entityType: "event",
      entityId: eventId,
      newData: input,
      ipAddress,
    });
    return { ok: true };
  });
}

const LINE_TABLES = { sale: "event_sales", cost: "event_costs", lead: "event_leads" } as const;

/** Removes one sale / cost / lead line of an event. */
export async function deleteEventLine(
  session: ActiveSession,
  eventId: string,
  kind: keyof typeof LINE_TABLES,
  lineId: number,
  { ipAddress = null }: Ctx = {},
): Promise<boolean> {
  assertCan(session, "events:manage", "analyst");
  const org = session.organization.id;
  const table = LINE_TABLES[kind];
  return withTransaction(async (conn) => {
    const row = await queryOne<Record<string, unknown>>(
      `SELECT * FROM ${table} WHERE organization_id = ? AND event_id = ? AND id = ? FOR UPDATE`,
      [org, eventId, lineId],
      conn,
    );
    if (!row) return false;
    await execute(
      `DELETE FROM ${table} WHERE organization_id = ? AND event_id = ? AND id = ?`,
      [org, eventId, lineId],
      conn,
    );
    await writeAudit(conn, {
      organizationId: org,
      actorUserId: session.user.id,
      action: `event.${kind}_deleted`,
      entityType: "event",
      entityId: eventId,
      oldData: row,
      ipAddress,
    });
    return true;
  });
}

export async function addCogsVersion(
  session: ActiveSession,
  input: z.output<typeof cogsSchema>,
  { ipAddress = null }: Ctx = {},
): Promise<AddResult> {
  assertCan(session, "master_data:manage", "admin");
  const org = session.organization.id;
  return withTransaction(async (conn) => {
    const v = await variantBySku(conn, org, input.sku);
    if (!v) return { ok: false, field: "sku", message: `SKU '${input.sku}' tidak ada di Master Produk.` };
    await execute(
      `INSERT INTO variant_cogs_history (organization_id, variant_id, effective_from, unit_cogs, note, created_by)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE unit_cogs = VALUES(unit_cogs), note = VALUES(note), created_by = VALUES(created_by)`,
      [org, v.id, input.effectiveFrom, input.unitCogs, input.note, session.user.id],
      conn,
    );
    await writeAudit(conn, {
      organizationId: org,
      actorUserId: session.user.id,
      action: "cogs.version_saved",
      entityType: "product_variant",
      entityId: v.id,
      newData: input,
      ipAddress,
    });
    return { ok: true };
  });
}
