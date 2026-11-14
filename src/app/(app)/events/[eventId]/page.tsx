import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Target, Trash2, TrendingUp, Users, Wallet } from "lucide-react";
import { requireRole } from "@/lib/auth/guards";
import { requireNavItem } from "@/config/navigation";
import { can } from "@/lib/auth/roles";
import { getEventDetail } from "@/lib/data/events";
import { formatDate, formatIDR, formatNumber } from "@/lib/format";
import {
  COST_CATEGORIES,
  COST_CATEGORY_LABELS,
  EVENT_KIND_LABELS,
  EVENT_KINDS,
  EVENT_STATUS_LABELS,
  EVENT_STATUSES,
  LEAD_SOURCE_LABELS,
  LEAD_SOURCES,
} from "@/lib/events/manage";
import { PageHeader } from "@/components/shared/page-header";
import { DemoNotice } from "@/components/shared/demo-badge";
import { KpiCard } from "@/components/shared/kpi-card";
import { ActionForm } from "@/components/shared/action-form";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  addCostAction,
  addLeadAction,
  addSaleAction,
  deleteEventAction,
  deleteLineAction,
  saveEventAction,
} from "../actions";
import { EventStatusBadge, money, NUM, pct, RESTRICTED, Statement } from "../events-ui";

export const metadata: Metadata = { title: "Detail Event" };

const day = (d: string) => formatDate(d, "UTC");

function DeleteLine({ eventId, kind, id }: { eventId: string; kind: "sale" | "cost" | "lead"; id: number }) {
  return (
    <form action={deleteLineAction}>
      <input type="hidden" name="eventId" value={eventId} />
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="lineId" value={id} />
      <Button type="submit" variant="ghost" size="sm" aria-label="Hapus baris">
        <Trash2 aria-hidden />
      </Button>
    </form>
  );
}

export default async function EventDetailPage({ params }: PageProps<"/events/[eventId]">) {
  const item = requireNavItem("/events");
  const session = await requireRole(item.minRole);
  const { eventId } = await params;
  if (!/^[0-9a-f-]{36}$/.test(eventId)) notFound();
  const data = await getEventDetail(session, eventId);
  if (data.status === "not_found") notFound();

  const { event: ev, total, eventOnly, restricted } = data;
  const canEdit = can(session.role, "events:manage");
  const hidden = { eventId: ev.id };
  const postSales = data.sales.filter((s) => s.phase === "pasca_event");
  const outside = data.sales.filter((s) => !s.counted);

  return (
    <div className="space-y-6">
      <div>
        <Button asChild variant="ghost" size="sm" className="-ml-2">
          <Link href="/events">
            <ArrowLeft aria-hidden /> Profitabilitas Event
          </Link>
        </Button>
      </div>
      <PageHeader
        title={ev.name}
        description={`${EVENT_KIND_LABELS[ev.kind]} · ${day(ev.startDate)}${ev.endDate !== ev.startDate ? ` – ${day(ev.endDate)}` : ""}${ev.location ? ` · ${ev.location}` : ""} · atribusi pasca-event s.d. ${day(ev.attributionEnd)}`}
        isDemo={session.organization.isDemo}
        actions={<EventStatusBadge status={ev.status} />}
      />
      {session.organization.isDemo ? <DemoNotice /> : null}
      {restricted ? (
        <Alert>
          <AlertDescription>COGS dan laba hanya terlihat oleh Analyst ke atas.</AlertDescription>
        </Alert>
      ) : total.missingCogs.length ? (
        <Alert variant="warning">
          <AlertDescription>
            COGS belum diketahui untuk {total.missingCogs.join(", ")} — laba tidak dihitung (bukan dianggap nol). Isi
            COGS di tab COGS produk.
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Pendapatan"
          value={formatIDR(total.revenue, { compact: true })}
          hint={`${formatNumber(total.units)} unit · pasca-event ${formatIDR(total.revenue - eventOnly.revenue, { compact: true })}`}
          icon={Wallet}
        />
        <KpiCard
          label="Laba bersih event"
          value={
            restricted ? RESTRICTED : total.netProfit === null ? null : formatIDR(total.netProfit, { compact: true })
          }
          hint={restricted ? undefined : `ROI ${pct(total.roi)} · contribution margin ${pct(total.contributionMargin)}`}
          icon={TrendingUp}
        />
        <KpiCard
          label="Break-even"
          value={
            restricted
              ? RESTRICTED
              : total.breakEvenRevenue === null
                ? null
                : formatIDR(total.breakEvenRevenue, { compact: true })
          }
          hint={
            restricted
              ? undefined
              : total.breakEvenGap === null
                ? "Margin ≤ 0: tidak bisa balik modal"
                : total.breakEvenGap === 0
                  ? "Tercapai"
                  : `Kurang ${formatIDR(total.breakEvenGap, { compact: true })}`
          }
          icon={Target}
        />
        <KpiCard
          label="Lead"
          value={formatNumber(data.leadTotals.leads)}
          hint={`${formatNumber(data.leadTotals.converted)} konversi (${pct(data.leadTotals.conversionRate, 0)})`}
          icon={Users}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Laporan laba event</CardTitle>
          <CardDescription>
            Contribution = pendapatan − COGS − biaya variabel. Break-even = biaya tetap ÷ contribution margin. ROI =
            laba bersih ÷ (COGS + semua biaya).
          </CardDescription>
        </CardHeader>
        <CardContent className="px-0">
          <Statement eventOnly={eventOnly} total={total} restricted={restricted} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Penjualan</CardTitle>
          <CardDescription>
            Pendapatan bersih yang diterima per SKU. Penjualan pasca-event dihitung bila terjadi setelah{" "}
            {day(ev.endDate)} s.d. {day(ev.attributionEnd)} ({ev.attributionDays} hari).
            {postSales.length ? ` ${postSales.length} baris pasca-event.` : ""}
            {outside.length ? ` ${outside.length} baris di luar periode tidak dihitung.` : ""}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 px-0">
          {data.sales.length ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tanggal</TableHead>
                  <TableHead>SKU</TableHead>
                  <TableHead>Fase</TableHead>
                  <TableHead className="text-right">Unit</TableHead>
                  <TableHead className="text-right">Pendapatan</TableHead>
                  <TableHead className="text-right">COGS/unit</TableHead>
                  {canEdit ? <TableHead className="sr-only">Aksi</TableHead> : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.sales.map((s) => (
                  <TableRow key={s.id} className={s.counted ? "" : "text-muted-foreground line-through"}>
                    <TableCell className="whitespace-nowrap">{day(s.soldOn)}</TableCell>
                    <TableCell>
                      <span className="font-mono text-xs">{s.sku}</span>
                      {s.note ? <span className="block text-xs text-muted-foreground">{s.note}</span> : null}
                    </TableCell>
                    <TableCell>
                      {s.phase === "event" ? (
                        <Badge variant="outline">Event</Badge>
                      ) : (
                        <Badge variant="secondary">Pasca-event</Badge>
                      )}
                    </TableCell>
                    <TableCell className={NUM}>{formatNumber(s.units)}</TableCell>
                    <TableCell className={NUM}>{formatIDR(s.revenue)}</TableCell>
                    <TableCell className={NUM}>{money(s.unitCogs, restricted)}</TableCell>
                    {canEdit ? (
                      <TableCell>
                        <DeleteLine eventId={ev.id} kind="sale" id={s.id} />
                      </TableCell>
                    ) : null}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="px-6 text-sm text-muted-foreground">Belum ada penjualan.</p>
          )}
          {canEdit ? (
            <div className="border-t px-6 pt-4">
              <ActionForm
                action={addSaleAction}
                hidden={hidden}
                submitLabel="Tambah penjualan"
                columns={3}
                fields={[
                  {
                    name: "sku",
                    label: "SKU",
                    type: "select",
                    options: data.skus.map((s) => ({ value: s, label: s })),
                  },
                  { name: "soldOn", label: "Tanggal", type: "date", defaultValue: ev.startDate },
                  {
                    name: "phase",
                    label: "Fase",
                    type: "select",
                    options: [
                      { value: "event", label: "Saat event" },
                      { value: "pasca_event", label: "Pasca-event (atribusi)" },
                    ],
                  },
                  { name: "units", label: "Unit", type: "number" },
                  { name: "revenue", label: "Pendapatan bersih (Rp)", type: "number", placeholder: "mis. 1.500.000" },
                  { name: "note", label: "Catatan", type: "text" },
                ]}
              />
            </div>
          ) : null}
        </CardContent>
      </Card>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Biaya</CardTitle>
            <CardDescription>
              Tetap: tidak bergantung penjualan (booth, transport). Variabel: ikut naik dengan penjualan.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 px-0">
            {data.costs.length ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Kategori</TableHead>
                    <TableHead>Jenis</TableHead>
                    <TableHead className="text-right">Jumlah</TableHead>
                    {canEdit ? <TableHead className="sr-only">Aksi</TableHead> : null}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.costs.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell>
                        {COST_CATEGORY_LABELS[c.category]}
                        {c.note ? <span className="block text-xs text-muted-foreground">{c.note}</span> : null}
                      </TableCell>
                      <TableCell>{c.costType === "tetap" ? "Tetap" : "Variabel"}</TableCell>
                      <TableCell className={NUM}>{formatIDR(c.amount)}</TableCell>
                      {canEdit ? (
                        <TableCell>
                          <DeleteLine eventId={ev.id} kind="cost" id={c.id} />
                        </TableCell>
                      ) : null}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <p className="px-6 text-sm text-muted-foreground">Belum ada biaya.</p>
            )}
            {canEdit ? (
              <div className="border-t px-6 pt-4">
                <ActionForm
                  action={addCostAction}
                  hidden={hidden}
                  submitLabel="Tambah biaya"
                  fields={[
                    {
                      name: "category",
                      label: "Kategori",
                      type: "select",
                      options: COST_CATEGORIES.map((c) => ({ value: c, label: COST_CATEGORY_LABELS[c] })),
                    },
                    {
                      name: "costType",
                      label: "Jenis",
                      type: "select",
                      options: [
                        { value: "tetap", label: "Tetap" },
                        { value: "variabel", label: "Variabel" },
                      ],
                    },
                    { name: "amount", label: "Jumlah (Rp)", type: "number" },
                    { name: "incurredOn", label: "Tanggal (opsional)", type: "date" },
                    { name: "note", label: "Catatan", type: "text", wide: true },
                  ]}
                />
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Lead</CardTitle>
            <CardDescription>
              Jumlah lead per sumber (tanpa data pribadi) dan berapa yang menjadi pembeli.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 px-0">
            {data.leads.length ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Tanggal</TableHead>
                    <TableHead>Sumber</TableHead>
                    <TableHead className="text-right">Lead</TableHead>
                    <TableHead className="text-right">Konversi</TableHead>
                    {canEdit ? <TableHead className="sr-only">Aksi</TableHead> : null}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.leads.map((l) => (
                    <TableRow key={l.id}>
                      <TableCell className="whitespace-nowrap">{day(l.capturedOn)}</TableCell>
                      <TableCell>{LEAD_SOURCE_LABELS[l.source]}</TableCell>
                      <TableCell className={NUM}>{formatNumber(l.leads)}</TableCell>
                      <TableCell className={NUM}>{formatNumber(l.converted)}</TableCell>
                      {canEdit ? (
                        <TableCell>
                          <DeleteLine eventId={ev.id} kind="lead" id={l.id} />
                        </TableCell>
                      ) : null}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <p className="px-6 text-sm text-muted-foreground">Belum ada lead.</p>
            )}
            {canEdit ? (
              <div className="border-t px-6 pt-4">
                <ActionForm
                  action={addLeadAction}
                  hidden={hidden}
                  submitLabel="Tambah lead"
                  fields={[
                    { name: "capturedOn", label: "Tanggal", type: "date", defaultValue: ev.startDate },
                    {
                      name: "source",
                      label: "Sumber",
                      type: "select",
                      options: LEAD_SOURCES.map((s) => ({ value: s, label: LEAD_SOURCE_LABELS[s] })),
                    },
                    { name: "leads", label: "Jumlah lead", type: "number" },
                    { name: "converted", label: "Menjadi pembeli", type: "number", defaultValue: "0" },
                    { name: "note", label: "Catatan", type: "text", wide: true },
                  ]}
                />
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>

      {canEdit ? (
        <Card className="max-w-3xl">
          <CardHeader>
            <CardTitle className="text-sm">Ubah event</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4">
            <ActionForm
              action={saveEventAction}
              hidden={{ id: ev.id }}
              submitLabel="Simpan perubahan"
              resetOnSuccess={false}
              fields={[
                { name: "name", label: "Nama event", type: "text", defaultValue: ev.name, wide: true },
                {
                  name: "kind",
                  label: "Jenis",
                  type: "select",
                  defaultValue: ev.kind,
                  options: EVENT_KINDS.map((k) => ({ value: k, label: EVENT_KIND_LABELS[k] })),
                },
                { name: "location", label: "Lokasi", type: "text", defaultValue: ev.location ?? "" },
                { name: "startDate", label: "Tanggal mulai", type: "date", defaultValue: ev.startDate },
                { name: "endDate", label: "Tanggal selesai", type: "date", defaultValue: ev.endDate },
                {
                  name: "status",
                  label: "Status",
                  type: "select",
                  defaultValue: ev.status,
                  options: EVENT_STATUSES.map((s) => ({ value: s, label: EVENT_STATUS_LABELS[s] })),
                },
                {
                  name: "attributionDays",
                  label: "Masa atribusi (hari)",
                  type: "number",
                  defaultValue: String(ev.attributionDays),
                },
                { name: "notes", label: "Catatan", type: "text", defaultValue: ev.notes ?? "", wide: true },
              ]}
            />
            <form action={deleteEventAction}>
              <input type="hidden" name="id" value={ev.id} />
              <Button type="submit" variant="outline" size="sm">
                <Trash2 aria-hidden /> Hapus event beserta seluruh datanya
              </Button>
            </form>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
