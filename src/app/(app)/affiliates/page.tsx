import type { Metadata } from "next";
import Link from "next/link";
import { AlertCircle, CheckCircle2, FileUp, Package, ShoppingBag, Users, Wallet, Warehouse } from "lucide-react";
import { requireRole } from "@/lib/auth/guards";
import { requireNavItem } from "@/config/navigation";
import { can, hasRole } from "@/lib/auth/roles";
import { getAffiliatesOverview } from "@/lib/data/affiliates";
import { RANGE_PRESET_LABELS } from "@/lib/ecommerce/date-range";
import { todayInTimeZone } from "@/lib/imports/validate";
import { formatDate, formatDateTime, formatIDR, formatNumber, MISSING } from "@/lib/format";
import { PageHeader } from "@/components/shared/page-header";
import { DemoNotice } from "@/components/shared/demo-badge";
import { DataSourceLabel } from "@/components/shared/data-source-label";
import { DateRangeFilter } from "@/components/shared/date-range-filter";
import { EmptyState } from "@/components/shared/empty-state";
import { KpiCard } from "@/components/shared/kpi-card";
import { ActionForm } from "@/components/shared/action-form";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  allocationSettingsAction,
  applyAction,
  approveAction,
  movementAction,
  proposeAction,
  rejectAction,
  toggleAffiliateAction,
} from "./actions";

export const metadata: Metadata = { title: "Afiliasi HSL" };

const NUM = "text-right tabular-nums";
const day = (d: string) => formatDate(d, "UTC");
const period = (from: string, to: string) => (from === to ? day(from) : `${day(from)} – ${day(to)}`);
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const pct = (v: number | null) =>
  v === null ? MISSING : new Intl.NumberFormat("id-ID", { style: "percent", maximumFractionDigits: 0 }).format(v);
const dec = (v: number | null, d = 1) =>
  v === null ? MISSING : new Intl.NumberFormat("id-ID", { maximumFractionDigits: d }).format(v);

const STATUS: Record<string, { label: string; variant: "outline" | "warning" | "success" | "secondary" }> = {
  diusulkan: { label: "Diusulkan", variant: "outline" },
  disetujui: { label: "Disetujui", variant: "warning" },
  diterapkan: { label: "Diterapkan", variant: "success" },
  ditolak: { label: "Ditolak", variant: "secondary" },
};

export default async function AffiliatesPage({ searchParams }: PageProps<"/affiliates">) {
  const item = requireNavItem("/affiliates");
  const session = await requireRole(item.minRole);
  const { organization } = session;
  const sp = await searchParams;
  const data = await getAffiliatesOverview(session, { range: first(sp.range), from: first(sp.from), to: first(sp.to) });
  const canPropose = can(session.role, "allocations:propose");
  const canApprove = can(session.role, "allocations:approve");
  const canStock = can(session.role, "inventory:manage");
  const notice = first(sp.pesan);
  const error = first(sp.galat);

  const header = (
    <>
      <PageHeader title={item.title} description={item.description} isDemo={organization.isDemo} />
      {organization.isDemo ? <DemoNotice /> : null}
    </>
  );

  if (data.status === "empty") {
    return (
      <div className="space-y-6">
        {header}
        <EmptyState
          icon={Users}
          title="Belum ada penjualan afiliasi HSL"
          description="Impor laporan Penjualan Afiliasi Shopee HSL (afiliasi dibuat otomatis dari username) lalu simpan."
        >
          {hasRole(session.role, "analyst") ? (
            <Button asChild>
              <Link href="/imports">
                <FileUp aria-hidden /> Impor Data
              </Link>
            </Button>
          ) : null}
        </EmptyState>
      </div>
    );
  }

  const { range, settings, affiliates, stock } = data;
  const totals = {
    gmv: affiliates.reduce((s, a) => s + a.gmv, 0),
    units: affiliates.reduce((s, a) => s + a.units, 0),
    locked: stock.reduce((s, x) => s + x.locked, 0),
    warehouse: stock.reduce((s, x) => s + x.warehouse, 0),
  };
  const commissions = affiliates.map((a) => a.commission);
  const commission = commissions.some((c) => c !== null) ? commissions.reduce<number>((s, c) => s + (c ?? 0), 0) : null;
  const open = data.allocations.filter((a) => a.status === "diusulkan" || a.status === "disetujui");
  const history = data.allocations.filter((a) => a.status === "diterapkan" || a.status === "ditolak");
  const today = todayInTimeZone(organization.timezone);

  return (
    <div className="space-y-6">
      {header}

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <p className="text-sm">
            <span className="font-medium">{RANGE_PRESET_LABELS[range.preset]}</span>: {period(range.from, range.to)} ·
            data s.d. {day(data.asOf)} · velocity {settings.windowDays} hari terakhir
          </p>
          <DataSourceLabel
            source="Impor Shopee HSL + buku stok"
            updatedAt={data.lastImportAt}
            timeZone={organization.timezone}
          />
        </div>
        <DateRangeFilter
          key={`${range.preset}|${range.from}|${range.to}`}
          action="/affiliates"
          preset={range.preset}
          from={range.from}
          to={range.to}
          min={data.dataFrom}
          max={data.asOf}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        <KpiCard
          label="GMV afiliasi"
          value={formatIDR(totals.gmv, { compact: true })}
          hint={`${affiliates.filter((a) => a.gmv > 0).length} afiliasi berjualan`}
          icon={Wallet}
        />
        <KpiCard label="Unit terjual" value={formatNumber(totals.units)} hint="Unit SKU" icon={ShoppingBag} />
        <KpiCard
          label="Komisi"
          value={commission === null ? null : formatIDR(commission, { compact: true })}
          icon={Users}
        />
        <KpiCard
          label="Stok di afiliasi"
          value={formatNumber(totals.locked)}
          hint="Terkunci (alokasi − retur − terjual)"
          icon={Package}
        />
        <KpiCard
          label="Stok gudang"
          value={formatNumber(totals.warehouse)}
          hint="Bebas dialokasikan"
          icon={Warehouse}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Peringkat afiliasi · {period(range.from, range.to)}</CardTitle>
          <CardDescription>
            Velocity = unit/hari dalam {settings.windowDays} hari terakhir. Sell-through = terjual ÷ (terjual + stok
            tersisa). Cakupan = stok tersisa ÷ velocity.
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto px-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>#</TableHead>
                <TableHead>Afiliasi</TableHead>
                <TableHead className="text-right">GMV</TableHead>
                <TableHead className="text-right">Unit</TableHead>
                <TableHead className="text-right">Komisi</TableHead>
                <TableHead className="text-right">Velocity/hari</TableHead>
                <TableHead className="text-right">Stok tersisa</TableHead>
                <TableHead className="text-right">Sell-through</TableHead>
                <TableHead className="text-right">Cakupan</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {affiliates.map((a, i) => (
                <TableRow key={a.id} className={a.status === "nonaktif" ? "text-muted-foreground" : ""}>
                  <TableCell className="tabular-nums">{i + 1}</TableCell>
                  <TableCell>
                    <span className="font-medium">{a.name}</span>
                    <span className="block text-xs text-muted-foreground">
                      @{a.username}
                      {a.status === "nonaktif" ? " · nonaktif" : ""}
                    </span>
                    {a.oversold ? <Badge variant="warning">Terjual &gt; stok tercatat</Badge> : null}
                  </TableCell>
                  <TableCell className={NUM}>{formatIDR(a.gmv, { compact: true })}</TableCell>
                  <TableCell className={NUM}>{formatNumber(a.units)}</TableCell>
                  <TableCell className={NUM}>
                    {a.commission === null ? MISSING : formatIDR(a.commission, { compact: true })}
                  </TableCell>
                  <TableCell className={NUM}>{dec(a.velocity)}</TableCell>
                  <TableCell className={NUM}>{formatNumber(a.locked)}</TableCell>
                  <TableCell className={NUM}>{pct(a.sellThrough)}</TableCell>
                  <TableCell className={NUM}>
                    {a.daysOfCover === null ? MISSING : `${dec(a.daysOfCover, 0)} hari`}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {data.unmappedGmv > 0 ? (
            <p className="px-6 pt-3 text-xs text-warning-foreground">
              {formatIDR(data.unmappedGmv)} GMV dari listing yang belum dipetakan ke SKU tidak masuk perhitungan stok.
            </p>
          ) : null}
        </CardContent>
      </Card>

      <section id="alokasi" className="scroll-mt-6 space-y-6">
        {notice ? (
          <Alert>
            <CheckCircle2 aria-hidden />
            <AlertDescription>{notice}</AlertDescription>
          </Alert>
        ) : null}
        {error ? (
          <Alert variant="destructive">
            <AlertCircle aria-hidden />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Rekomendasi alokasi</CardTitle>
            <CardDescription>
              Target stok = velocity × {settings.coverDays} hari; usulan = target − stok tersisa, afiliasi tercepat
              didahulukan, dibatasi stok gudang yang belum dijanjikan. Tidak ada stok yang berpindah sebelum Admin
              menyetujui dan menerapkan.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 px-0">
            {data.recommendations.length ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Afiliasi</TableHead>
                    <TableHead>SKU</TableHead>
                    <TableHead className="text-right">Velocity</TableHead>
                    <TableHead className="text-right">Stok tersisa</TableHead>
                    <TableHead className="text-right">Target</TableHead>
                    <TableHead className="text-right">Usulan</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.recommendations.map((r) => (
                    <TableRow key={`${r.affiliateId}-${r.sku}`}>
                      <TableCell>{r.affiliateName}</TableCell>
                      <TableCell className="font-mono text-xs">{r.sku}</TableCell>
                      <TableCell className={NUM}>{dec(r.velocity)}</TableCell>
                      <TableCell className={NUM}>{formatNumber(r.locked)}</TableCell>
                      <TableCell className={NUM}>{formatNumber(r.target)}</TableCell>
                      <TableCell className={NUM}>
                        {formatNumber(r.quantity)}
                        {r.capped ? (
                          <Badge variant="warning" className="ml-2">
                            stok kurang {formatNumber(r.need - r.quantity)}
                          </Badge>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <p className="px-6 text-sm text-muted-foreground">Semua afiliasi aktif sudah punya stok cukup.</p>
            )}
            {canPropose && data.recommendations.some((r) => r.quantity > 0) ? (
              <form action={proposeAction} className="px-6">
                <Button type="submit">Simpan sebagai usulan</Button>
              </form>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Usulan menunggu keputusan</CardTitle>
            <CardDescription>
              {canApprove
                ? "Setujui (jumlah boleh diubah, tidak boleh melebihi stok gudang), lalu terapkan untuk memindahkan stok."
                : "Hanya Admin yang dapat menyetujui dan menerapkan alokasi."}
            </CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto px-0">
            {open.length ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Afiliasi</TableHead>
                    <TableHead>SKU</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Diusulkan</TableHead>
                    <TableHead className="text-right">Disetujui</TableHead>
                    <TableHead>Dasar</TableHead>
                    {canApprove ? <TableHead>Aksi</TableHead> : null}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {open.map((a) => (
                    <TableRow key={a.id}>
                      <TableCell>{a.affiliateName}</TableCell>
                      <TableCell className="font-mono text-xs">{a.sku}</TableCell>
                      <TableCell>
                        <Badge variant={STATUS[a.status].variant}>{STATUS[a.status].label}</Badge>
                      </TableCell>
                      <TableCell className={NUM}>{formatNumber(a.proposedQty)}</TableCell>
                      <TableCell className={NUM}>
                        {a.approvedQty === null ? MISSING : formatNumber(a.approvedQty)}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {a.basis
                          ? `velocity ${dec(Number(a.basis.velocity))}/hari × ${a.basis.coverDays} hari − stok ${a.basis.locked}`
                          : MISSING}
                      </TableCell>
                      {canApprove ? (
                        <TableCell>
                          <div className="flex flex-wrap items-center gap-2">
                            {a.status === "diusulkan" ? (
                              <form action={approveAction} className="flex items-center gap-2">
                                <input type="hidden" name="id" value={a.id} />
                                <label htmlFor={`qty-${a.id}`} className="sr-only">
                                  Jumlah disetujui
                                </label>
                                <Input
                                  id={`qty-${a.id}`}
                                  name="quantity"
                                  inputMode="numeric"
                                  defaultValue={String(a.proposedQty)}
                                  className="h-8 w-20"
                                />
                                <Button type="submit" size="sm">
                                  Setujui
                                </Button>
                              </form>
                            ) : (
                              <form action={applyAction}>
                                <input type="hidden" name="id" value={a.id} />
                                <Button type="submit" size="sm">
                                  Terapkan
                                </Button>
                              </form>
                            )}
                            <form action={rejectAction}>
                              <input type="hidden" name="id" value={a.id} />
                              <Button type="submit" size="sm" variant="outline">
                                Tolak
                              </Button>
                            </form>
                          </div>
                        </TableCell>
                      ) : null}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <p className="px-6 text-sm text-muted-foreground">Tidak ada usulan yang menunggu.</p>
            )}
          </CardContent>
        </Card>
      </section>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Stok per SKU</CardTitle>
            <CardDescription>
              Gudang = bebas dialokasikan; dijanjikan = alokasi disetujui yang belum diterapkan.
            </CardDescription>
          </CardHeader>
          <CardContent className="px-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>SKU</TableHead>
                  <TableHead className="text-right">Gudang</TableHead>
                  <TableHead className="text-right">Dijanjikan</TableHead>
                  <TableHead className="text-right">Di afiliasi</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {stock.map((s) => (
                  <TableRow key={s.sku}>
                    <TableCell className="font-mono text-xs">{s.sku}</TableCell>
                    <TableCell className={NUM}>{formatNumber(s.warehouse)}</TableCell>
                    <TableCell className={NUM}>{s.reserved ? formatNumber(s.reserved) : MISSING}</TableCell>
                    <TableCell className={NUM}>{formatNumber(s.locked)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Stok diam di afiliasi</CardTitle>
            <CardDescription>
              Tidak terjual dalam {settings.windowDays} hari terakhir atau cakupan &gt; {settings.coverDays * 3} hari —
              pertimbangkan retur atau pindahkan ke afiliasi lain.
            </CardDescription>
          </CardHeader>
          <CardContent className="px-0">
            {data.idle.length ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Afiliasi</TableHead>
                    <TableHead>SKU</TableHead>
                    <TableHead className="text-right">Stok</TableHead>
                    <TableHead className="text-right">Cakupan</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.idle.map((r) => (
                    <TableRow key={`${r.affiliateId}-${r.sku}`}>
                      <TableCell>{r.affiliateName}</TableCell>
                      <TableCell className="font-mono text-xs">{r.sku}</TableCell>
                      <TableCell className={NUM}>{formatNumber(r.locked)}</TableCell>
                      <TableCell className={NUM}>
                        {r.daysOfCover === null ? "Tidak bergerak" : `${dec(r.daysOfCover, 0)} hari`}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <p className="px-6 text-sm text-muted-foreground">Tidak ada stok diam.</p>
            )}
          </CardContent>
        </Card>
      </div>

      {history.length ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Riwayat alokasi</CardTitle>
          </CardHeader>
          <CardContent className="max-h-96 overflow-auto px-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Diterapkan / ditolak</TableHead>
                  <TableHead>Afiliasi</TableHead>
                  <TableHead>SKU</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Unit</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {history.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell className="whitespace-nowrap">
                      {formatDateTime(a.appliedAt ?? a.decidedAt ?? a.proposedAt, organization.timezone)}
                    </TableCell>
                    <TableCell>{a.affiliateName}</TableCell>
                    <TableCell className="font-mono text-xs">{a.sku}</TableCell>
                    <TableCell>
                      <Badge variant={STATUS[a.status].variant}>{STATUS[a.status].label}</Badge>
                    </TableCell>
                    <TableCell className={NUM}>{formatNumber(a.approvedQty ?? a.proposedQty)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : null}

      {canStock || canApprove ? (
        <div className="grid gap-6 xl:grid-cols-2">
          {canStock ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Catat pergerakan stok</CardTitle>
                <CardDescription>
                  Barang masuk ke gudang, penyesuaian hasil stock opname, atau retur dari afiliasi.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ActionForm
                  action={movementAction}
                  submitLabel="Catat"
                  fields={[
                    {
                      name: "sku",
                      label: "SKU",
                      type: "select",
                      options: stock.map((s) => ({ value: s.sku, label: s.sku })),
                    },
                    {
                      name: "type",
                      label: "Jenis",
                      type: "select",
                      options: [
                        { value: "masuk", label: "Barang masuk gudang" },
                        { value: "penyesuaian_tambah", label: "Penyesuaian (+)" },
                        { value: "penyesuaian_kurang", label: "Penyesuaian (−)" },
                        { value: "retur", label: "Retur dari afiliasi" },
                      ],
                    },
                    { name: "quantity", label: "Jumlah (unit)", type: "number" },
                    {
                      name: "affiliateId",
                      label: "Afiliasi (untuk retur)",
                      type: "select",
                      options: [{ value: "", label: "—" }, ...affiliates.map((a) => ({ value: a.id, label: a.name }))],
                    },
                    { name: "occurredOn", label: "Tanggal", type: "date", defaultValue: today },
                    { name: "note", label: "Catatan", type: "text" },
                  ]}
                />
              </CardContent>
            </Card>
          ) : null}
          {canApprove ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Pengaturan alokasi</CardTitle>
                <CardDescription>Multiple cakupan dan jendela velocity untuk rekomendasi.</CardDescription>
              </CardHeader>
              <CardContent>
                <ActionForm
                  action={allocationSettingsAction}
                  submitLabel="Simpan pengaturan"
                  resetOnSuccess={false}
                  fields={[
                    {
                      name: "coverDays",
                      label: "Cakupan stok (hari)",
                      type: "number",
                      defaultValue: String(settings.coverDays),
                    },
                    {
                      name: "windowDays",
                      label: "Jendela velocity (hari)",
                      type: "number",
                      defaultValue: String(settings.windowDays),
                    },
                  ]}
                />
              </CardContent>
            </Card>
          ) : null}
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Master afiliasi</CardTitle>
          <CardDescription>
            Afiliasi baru dibuat otomatis dari impor HSL (berdasarkan username). Afiliasi nonaktif tidak mendapat
            rekomendasi alokasi.
          </CardDescription>
        </CardHeader>
        <CardContent className="px-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nama</TableHead>
                <TableHead>Username</TableHead>
                <TableHead>Status</TableHead>
                {canPropose ? <TableHead className="sr-only">Aksi</TableHead> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {[...affiliates]
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((a) => (
                  <TableRow key={a.id}>
                    <TableCell>{a.name}</TableCell>
                    <TableCell className="text-muted-foreground">@{a.username}</TableCell>
                    <TableCell>
                      <Badge variant={a.status === "aktif" ? "success" : "secondary"}>
                        {a.status === "aktif" ? "Aktif" : "Nonaktif"}
                      </Badge>
                    </TableCell>
                    {canPropose ? (
                      <TableCell>
                        <form action={toggleAffiliateAction}>
                          <input type="hidden" name="id" value={a.id} />
                          <input type="hidden" name="name" value={a.name} />
                          <input type="hidden" name="notes" value={a.notes ?? ""} />
                          <input type="hidden" name="status" value={a.status === "aktif" ? "nonaktif" : "aktif"} />
                          <Button type="submit" variant="outline" size="sm">
                            {a.status === "aktif" ? "Nonaktifkan" : "Aktifkan"}
                          </Button>
                        </form>
                      </TableCell>
                    ) : null}
                  </TableRow>
                ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
