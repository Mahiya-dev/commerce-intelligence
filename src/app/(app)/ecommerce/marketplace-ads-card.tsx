import type { MarketplaceAdsRow } from "@/lib/data/marketplace-ads";
import { formatIDR, formatNumber, formatPercent, MISSING } from "@/lib/format";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const NUM = "text-right tabular-nums";
const ratio = (a: number, b: number) => (b === 0 ? null : a / b);
const roas = (v: number | null) =>
  v === null ? MISSING : `${new Intl.NumberFormat("id-ID", { maximumFractionDigits: 2 }).format(v)}×`;

/**
 * Marketplace ads per channel for the selected range. ROAS/ACOS use the sales the
 * marketplace attributes to its ads; "Biaya ÷ GMV toko" compares spend with the
 * whole shop GMV from the shop report (the honest cost-of-sales view).
 */
export function MarketplaceAdsCard({
  rows,
  shopGmv,
  rangeDays,
  periodLabel,
}: {
  rows: MarketplaceAdsRow[];
  shopGmv: Record<string, number>;
  rangeDays: number;
  periodLabel: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Iklan marketplace · {periodLabel}</CardTitle>
        <CardDescription>
          Dari laporan iklan marketplace (mis. Shopee Ads). Omzet iklan = penjualan yang diatribusikan marketplace ke
          iklan, termasuk pesanan yang belum tentu dikirim, jadi tidak bisa dijumlahkan dengan GMV toko. ROAS = omzet
          iklan ÷ biaya; ACOS = biaya ÷ omzet iklan; Biaya ÷ GMV toko = porsi biaya iklan terhadap seluruh GMV toko.
        </CardDescription>
      </CardHeader>
      <CardContent className="px-0">
        {rows.length === 0 ? (
          <p className="px-6 text-sm text-muted-foreground">
            Belum ada laporan iklan pada rentang ini. Unggah ekspor <strong>Data Keseluruhan Iklan</strong> Shopee (per
            hari) di menu Impor Data.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Channel</TableHead>
                <TableHead className="text-right">Biaya iklan</TableHead>
                <TableHead className="text-right">Omzet iklan</TableHead>
                <TableHead className="text-right">ROAS</TableHead>
                <TableHead className="text-right">ACOS</TableHead>
                <TableHead className="text-right">Biaya ÷ GMV toko</TableHead>
                <TableHead className="text-right">Klik</TableHead>
                <TableHead className="text-right">Konversi</TableHead>
                <TableHead className="text-right">Hari data</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => {
                const shop = shopGmv[r.code];
                return (
                  <TableRow key={r.code}>
                    <TableCell className="font-medium">{r.name}</TableCell>
                    <TableCell className={NUM}>{formatIDR(r.cost)}</TableCell>
                    <TableCell className={NUM}>{formatIDR(r.gmv)}</TableCell>
                    <TableCell className={NUM}>{roas(ratio(r.gmv, r.cost))}</TableCell>
                    <TableCell className={NUM}>{formatPercent(ratio(r.cost, r.gmv))}</TableCell>
                    <TableCell className={NUM}>{shop ? formatPercent(ratio(r.cost, shop)) : MISSING}</TableCell>
                    <TableCell className={NUM}>{formatNumber(r.clicks)}</TableCell>
                    <TableCell className={NUM}>{formatNumber(r.conversions)}</TableCell>
                    <TableCell className={NUM}>
                      {r.days} / {rangeDays}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
        {rows.some((r) => r.days < rangeDays) ? (
          <p className="px-6 pt-3 text-xs text-warning-foreground">
            Laporan iklan belum lengkap untuk semua hari di rentang ini; biaya dan omzet iklan hanya mencakup hari yang
            ada laporannya, sedangkan GMV toko mencakup seluruh rentang.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
