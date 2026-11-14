import type { Metadata } from "next";
import Link from "next/link";
import { CalendarRange } from "lucide-react";
import { requireRole } from "@/lib/auth/guards";
import { requireNavItem } from "@/config/navigation";
import { can } from "@/lib/auth/roles";
import { listEvents } from "@/lib/data/events";
import { formatDate, formatIDR, formatNumber } from "@/lib/format";
import { EVENT_KIND_LABELS, EVENT_KINDS, EVENT_STATUS_LABELS, EVENT_STATUSES } from "@/lib/events/manage";
import { PageHeader } from "@/components/shared/page-header";
import { DemoNotice } from "@/components/shared/demo-badge";
import { EmptyState } from "@/components/shared/empty-state";
import { KpiCard } from "@/components/shared/kpi-card";
import { ActionForm } from "@/components/shared/action-form";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { saveEventAction } from "./actions";
import { EventStatusBadge, EventsTabs, money, NUM, pct, ProfitText, RESTRICTED } from "./events-ui";

export const metadata: Metadata = { title: "Profitabilitas Event" };

const day = (d: string) => formatDate(d, "UTC");

export default async function EventsPage() {
  const item = requireNavItem("/events");
  const session = await requireRole(item.minRole);
  const { organization } = session;
  const { restricted, events } = await listEvents(session);
  const canEdit = can(session.role, "events:manage");
  const done = events.filter((e) => e.status === "selesai");
  const sum = (f: (e: (typeof events)[number]) => number | null) =>
    done.some((e) => f(e) === null) ? null : done.reduce((s, e) => s + (f(e) ?? 0), 0);
  const profitable = done.filter((e) => (e.total.netProfit ?? 0) > 0).length;

  return (
    <div className="space-y-6">
      <PageHeader
        title={item.title}
        description={item.description}
        isDemo={organization.isDemo}
        actions={<EventsTabs active="events" showCogs={can(session.role, "cogs:view")} />}
      />
      {organization.isDemo ? <DemoNotice /> : null}
      {restricted ? (
        <Alert>
          <AlertDescription>
            COGS dan laba event hanya terlihat oleh Analyst ke atas. Anda melihat pendapatan, biaya dan lead.
          </AlertDescription>
        </Alert>
      ) : null}

      {events.length === 0 ? (
        <EmptyState
          icon={CalendarRange}
          title="Belum ada event"
          description="Buat event pertama, lalu catat penjualan, biaya dan lead."
        />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <KpiCard label="Event selesai" value={formatNumber(done.length)} hint={`${events.length} event tercatat`} />
            <KpiCard
              label="Pendapatan (selesai)"
              value={formatIDR(
                sum((e) => e.total.revenue),
                { compact: true },
              )}
              hint="Termasuk atribusi pasca-event"
            />
            <KpiCard
              label="Laba bersih (selesai)"
              value={
                restricted
                  ? RESTRICTED
                  : formatIDR(
                      sum((e) => e.total.netProfit),
                      { compact: true },
                    )
              }
              hint={restricted ? undefined : `${profitable} dari ${done.length} event untung`}
            />
            <KpiCard
              label="Lead"
              value={formatNumber(events.reduce((s, e) => s + e.leads.leads, 0))}
              hint={`${formatNumber(events.reduce((s, e) => s + e.leads.converted, 0))} konversi`}
            />
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Perbandingan event</CardTitle>
              <CardDescription>
                Termasuk penjualan pasca-event dalam masa atribusi. Laba tidak pernah dihitung dari pendapatan kotor
                saja: COGS dan biaya selalu dikurangkan; &ldquo;—&rdquo; = COGS ada yang belum diketahui.
              </CardDescription>
            </CardHeader>
            <CardContent className="overflow-x-auto px-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Event</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Pendapatan</TableHead>
                    <TableHead className="text-right">Contribution</TableHead>
                    <TableHead className="text-right">Biaya tetap</TableHead>
                    <TableHead className="text-right">Laba bersih</TableHead>
                    <TableHead className="text-right">ROI</TableHead>
                    <TableHead className="text-right">Break-even</TableHead>
                    <TableHead className="text-right">Lead → konversi</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {events.map((e) => (
                    <TableRow key={e.id}>
                      <TableCell className="max-w-72">
                        <Link href={`/events/${e.id}`} className="font-medium underline-offset-4 hover:underline">
                          {e.name}
                        </Link>
                        <span className="block text-xs text-muted-foreground">
                          {EVENT_KIND_LABELS[e.kind]} · {day(e.startDate)}
                          {e.endDate !== e.startDate ? ` – ${day(e.endDate)}` : ""}
                          {e.location ? ` · ${e.location}` : ""}
                        </span>
                      </TableCell>
                      <TableCell>
                        <EventStatusBadge status={e.status} />
                      </TableCell>
                      <TableCell className={NUM}>{formatIDR(e.total.revenue, { compact: true })}</TableCell>
                      <TableCell className={NUM}>
                        <ProfitText value={e.total.contribution} restricted={restricted} />
                      </TableCell>
                      <TableCell className={NUM}>{formatIDR(e.total.fixedCosts, { compact: true })}</TableCell>
                      <TableCell className={NUM}>
                        <ProfitText value={e.total.netProfit} restricted={restricted} />
                      </TableCell>
                      <TableCell className={NUM}>{restricted ? RESTRICTED : pct(e.total.roi)}</TableCell>
                      <TableCell className={NUM}>
                        {restricted
                          ? RESTRICTED
                          : e.total.breakEvenGap === null
                            ? "Tidak tercapai"
                            : e.total.breakEvenGap === 0
                              ? "Tercapai"
                              : `Kurang ${money(e.total.breakEvenGap, false)}`}
                      </TableCell>
                      <TableCell className={NUM}>
                        {formatNumber(e.leads.leads)} → {formatNumber(e.leads.converted)}
                        {e.leads.conversionRate !== null ? ` (${pct(e.leads.conversionRate, 0)})` : ""}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}

      {canEdit ? (
        <Card className="max-w-3xl">
          <CardHeader>
            <CardTitle className="text-sm">Buat event</CardTitle>
            <CardDescription>
              Setelah dibuat, catat penjualan per SKU, biaya tetap/variabel dan lead di halaman event.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ActionForm
              action={saveEventAction}
              submitLabel="Buat event"
              fields={[
                { name: "name", label: "Nama event", type: "text", required: true, wide: true },
                {
                  name: "kind",
                  label: "Jenis",
                  type: "select",
                  options: EVENT_KINDS.map((k) => ({ value: k, label: EVENT_KIND_LABELS[k] })),
                },
                { name: "location", label: "Lokasi", type: "text" },
                { name: "startDate", label: "Tanggal mulai", type: "date", required: true },
                { name: "endDate", label: "Tanggal selesai", type: "date", required: true },
                {
                  name: "status",
                  label: "Status",
                  type: "select",
                  options: EVENT_STATUSES.map((s) => ({ value: s, label: EVENT_STATUS_LABELS[s] })),
                },
                {
                  name: "attributionDays",
                  label: "Masa atribusi pasca-event (hari)",
                  type: "number",
                  defaultValue: "30",
                },
                { name: "notes", label: "Catatan", type: "text", wide: true },
              ]}
            />
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
