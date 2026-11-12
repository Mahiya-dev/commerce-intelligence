import type { Metadata } from "next";
import { ExternalLink, ImageIcon, Trash2 } from "lucide-react";
import { requireRole } from "@/lib/auth/guards";
import { requireNavItem } from "@/config/navigation";
import { can } from "@/lib/auth/roles";
import { listCreativeAssets } from "@/lib/data/creative";
import { queryRows } from "@/lib/db/pool";
import { formatIDR, MISSING } from "@/lib/format";
import { FORMAT_LABELS } from "@/lib/creative/creative";
import { PageHeader } from "@/components/shared/page-header";
import { DemoNotice } from "@/components/shared/demo-badge";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { deleteAssetAction } from "../actions";
import { AssetForm } from "../forms";
import { CreativeTabs, NUM, roasText } from "../creative-ui";

export const metadata: Metadata = { title: "Library Aset Kreatif" };

export default async function CreativeAssetsPage() {
  const item = requireNavItem("/creative");
  const session = await requireRole(item.minRole);
  const { organization } = session;
  const canEdit = can(session.role, "creative:classify");
  const [assets, skuRows] = await Promise.all([
    listCreativeAssets(session),
    queryRows<{ sku: string }>("SELECT sku FROM product_variants WHERE organization_id = ? ORDER BY sku", [
      organization.id,
    ]),
  ]);
  const skus = skuRows.map((r) => r.sku);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Library aset kreatif"
        description="Gambar & video kreatif (metadata dan tautan). File tidak diunggah ke server; simpan di Google Drive/Meta lalu tempel tautannya."
        isDemo={organization.isDemo}
        actions={<CreativeTabs active="assets" />}
      />
      {organization.isDemo ? <DemoNotice /> : null}

      {canEdit ? (
        <Card className="max-w-3xl">
          <CardHeader>
            <CardTitle className="text-sm">Tambah aset</CardTitle>
            <CardDescription>Tautkan aset ke iklan dari halaman detail iklan.</CardDescription>
          </CardHeader>
          <CardContent>
            <AssetForm
              skus={skus}
              submitLabel="Tambah ke library"
              values={{ name: "", format: "video_in_frame", url: "", thumbnailUrl: "", sku: "", notes: "" }}
            />
          </CardContent>
        </Card>
      ) : null}

      {assets.length === 0 ? (
        <EmptyState icon={ImageIcon} title="Library masih kosong" description="Tambahkan aset kreatif pertama." />
      ) : (
        <Card className="py-0">
          <CardContent className="overflow-x-auto px-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Aset</TableHead>
                  <TableHead>Format</TableHead>
                  <TableHead>SKU</TableHead>
                  <TableHead className="text-right">Iklan</TableHead>
                  <TableHead className="text-right">Spend</TableHead>
                  <TableHead className="text-right">ROAS</TableHead>
                  <TableHead>Tautan</TableHead>
                  {canEdit ? <TableHead className="sr-only">Aksi</TableHead> : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {assets.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell className="max-w-72">
                      <span className="block truncate font-medium" title={a.name}>
                        {a.name}
                      </span>
                      {a.notes ? <span className="block truncate text-xs text-muted-foreground">{a.notes}</span> : null}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">{FORMAT_LABELS[a.format]}</TableCell>
                    <TableCell className="font-mono text-xs">{a.sku ?? MISSING}</TableCell>
                    <TableCell className={NUM}>{a.ads}</TableCell>
                    <TableCell className={NUM}>{a.spend ? formatIDR(a.spend, { compact: true }) : MISSING}</TableCell>
                    <TableCell className={NUM}>{roasText(a.spend ? a.revenue / a.spend : null)}</TableCell>
                    <TableCell>
                      {a.url ? (
                        <a
                          href={a.url}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="inline-flex items-center gap-1 text-xs underline underline-offset-4"
                        >
                          Buka <ExternalLink className="size-3" aria-hidden />
                        </a>
                      ) : (
                        MISSING
                      )}
                    </TableCell>
                    {canEdit ? (
                      <TableCell>
                        <form action={deleteAssetAction}>
                          <input type="hidden" name="id" value={a.id} />
                          <Button type="submit" variant="ghost" size="sm" aria-label={`Hapus ${a.name}`}>
                            <Trash2 aria-hidden />
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
      )}
    </div>
  );
}
