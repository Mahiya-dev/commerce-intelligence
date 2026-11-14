import type { SkuContribution } from "@/lib/data/ecommerce";
import { formatIDR, formatNumber, formatPercent } from "@/lib/format";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const NUM = "text-right tabular-nums";

/** GMV per internal SKU from product reports. shopGmv null = no shop report to compare with yet. */
export function SkuContributionCard({
  skus,
  listingGmv,
  shopGmv,
  periodLabel,
}: {
  skus: SkuContribution[];
  listingGmv: number;
  shopGmv: number | null;
  periodLabel: string;
}) {
  const gap = shopGmv === null ? 0 : shopGmv - listingGmv;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Kontribusi SKU internal · {periodLabel}</CardTitle>
        <CardDescription>
          Dari laporan Kinerja Produk Harian (termasuk ekspor Performa Produk Shopee), dipetakan ke SKU lewat Master
          Listing atau SKU Induk. Unit = unit listing × isi per listing. Paket (bundle) tampil sebagai SKU-nya sendiri.
        </CardDescription>
      </CardHeader>
      <CardContent className="px-0">
        {skus.length === 0 ? (
          <p className="px-6 text-sm text-muted-foreground">
            Laporan Kinerja Produk Harian untuk rentang ini belum diimpor.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>SKU</TableHead>
                <TableHead>Nama</TableHead>
                <TableHead className="text-right">GMV</TableHead>
                <TableHead className="text-right">Porsi</TableHead>
                <TableHead className="text-right">Unit SKU</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {skus.map((s) => (
                <TableRow key={s.sku ?? "unmapped"}>
                  <TableCell className="font-mono text-xs">{s.sku ?? "BELUM DIPETAKAN"}</TableCell>
                  <TableCell className={s.sku ? "" : "text-muted-foreground"}>
                    {s.name ?? "Listing belum dipetakan ke SKU internal"}
                  </TableCell>
                  <TableCell className={NUM}>{formatIDR(s.gmv)}</TableCell>
                  <TableCell className={NUM}>{formatPercent(listingGmv ? s.gmv / listingGmv : null, 1)}</TableCell>
                  <TableCell className={NUM}>{formatNumber(s.units)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        {skus.length && shopGmv !== null && gap !== 0 ? (
          <p className="px-6 pt-3 text-xs text-muted-foreground">
            Total GMV produk ({formatIDR(listingGmv)}) berbeda {formatIDR(Math.abs(gap))} dari GMV toko (
            {formatIDR(shopGmv)}). Biasanya karena laporan produk belum diimpor untuk semua hari atau channel.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
