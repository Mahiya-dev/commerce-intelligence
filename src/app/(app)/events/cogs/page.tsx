import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/guards";
import { requireNavItem } from "@/config/navigation";
import { can } from "@/lib/auth/roles";
import { listCogs } from "@/lib/data/events";
import { formatDate, formatIDR, MISSING } from "@/lib/format";
import { todayInTimeZone } from "@/lib/imports/validate";
import { PageHeader } from "@/components/shared/page-header";
import { DemoNotice } from "@/components/shared/demo-badge";
import { ActionForm } from "@/components/shared/action-form";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { addCogsAction } from "../actions";
import { EventsTabs, NUM } from "../events-ui";

export const metadata: Metadata = { title: "COGS Produk" };

export default async function CogsPage() {
  const item = requireNavItem("/events");
  const session = await requireRole(item.minRole);
  if (!can(session.role, "cogs:view")) redirect("/forbidden");
  const today = todayInTimeZone(session.organization.timezone);
  const rows = await listCogs(session, today);
  const canEdit = can(session.role, "master_data:manage");

  return (
    <div className="space-y-6">
      <PageHeader
        title="COGS produk (berversi)"
        description="COGS per unit yang berlaku pada tanggal penjualan dipakai untuk laba event. Urutan: versi terbaru yang berlaku → COGS standar di Master Produk → jumlah COGS komponen (bundle)."
        isDemo={session.organization.isDemo}
        actions={<EventsTabs active="cogs" showCogs />}
      />
      {session.organization.isDemo ? <DemoNotice /> : null}

      <Card className="py-0">
        <CardContent className="overflow-x-auto px-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>SKU</TableHead>
                <TableHead className="text-right">Berlaku hari ini</TableHead>
                <TableHead className="text-right">COGS standar</TableHead>
                <TableHead>Riwayat versi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.sku}>
                  <TableCell>
                    <span className="font-mono text-xs font-medium">{r.sku}</span>
                    {r.isBundle ? (
                      <Badge variant="outline" className="ml-2">
                        bundle
                      </Badge>
                    ) : null}
                    <span className="block text-xs text-muted-foreground">{r.name}</span>
                  </TableCell>
                  <TableCell className={NUM}>
                    {r.current === null ? <Badge variant="warning">Belum diketahui</Badge> : formatIDR(r.current)}
                  </TableCell>
                  <TableCell className={NUM}>{r.standardCogs === null ? MISSING : formatIDR(r.standardCogs)}</TableCell>
                  <TableCell className="text-xs">
                    {r.history.length
                      ? r.history.map((h) => (
                          <span key={h.effectiveFrom} className="block">
                            {formatDate(h.effectiveFrom, "UTC")}: {formatIDR(h.unitCogs)}
                            {h.note ? <span className="text-muted-foreground"> · {h.note}</span> : null}
                          </span>
                        ))
                      : r.isBundle && r.standardCogs === null
                        ? "Dihitung dari komponen"
                        : MISSING}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {canEdit ? (
        <Card className="max-w-3xl">
          <CardHeader>
            <CardTitle className="text-sm">Tambah versi COGS</CardTitle>
            <CardDescription>
              Berlaku untuk penjualan mulai tanggal tersebut; penjualan sebelumnya tetap memakai COGS lama. Tanggal yang
              sama menimpa versi sebelumnya.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ActionForm
              action={addCogsAction}
              submitLabel="Simpan versi"
              fields={[
                {
                  name: "sku",
                  label: "SKU",
                  type: "select",
                  options: rows.map((r) => ({ value: r.sku, label: `${r.sku} — ${r.name}` })),
                },
                { name: "effectiveFrom", label: "Berlaku mulai", type: "date", defaultValue: today },
                { name: "unitCogs", label: "COGS per unit (Rp)", type: "number" },
                { name: "note", label: "Catatan", type: "text", placeholder: "mis. kenaikan harga bahan baku" },
              ]}
            />
          </CardContent>
        </Card>
      ) : (
        <p className="text-xs text-muted-foreground">Hanya Admin yang dapat menambah versi COGS.</p>
      )}
    </div>
  );
}
