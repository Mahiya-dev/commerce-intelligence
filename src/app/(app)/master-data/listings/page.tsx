import type { Metadata } from "next";
import { Link2 } from "lucide-react";
import { requireRole } from "@/lib/auth/guards";
import { requireNavItem } from "@/config/navigation";
import { can } from "@/lib/auth/roles";
import { listChannelListings, listProductsWithVariants } from "@/lib/data/master-data";
import { AutoMapButton, ListingMapEditor } from "./listing-mapping-forms";
import { PageHeader } from "@/components/shared/page-header";
import { DataSourceLabel } from "@/components/shared/data-source-label";
import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const metadata: Metadata = { title: "Channel Listing" };

export default async function ListingsPage() {
  const item = requireNavItem("/master-data/listings");
  const session = await requireRole(item.minRole);
  const { organization } = session;
  const canMap = can(session.role, "listings:map");
  const [all, products] = await Promise.all([
    listChannelListings(session),
    canMap ? listProductsWithVariants(session, { includeCogs: false }) : [],
  ]);
  // Unmapped first: they are what needs attention.
  const listings = [...all].sort((a, b) => Number(Boolean(a.mappedSku)) - Number(Boolean(b.mappedSku)));
  const skuOptions = products.flatMap((p) => p.variants.map((v) => ({ sku: v.sku, name: v.name })));
  const unmapped = listings.filter((l) => !l.mappedSku).length;
  const latest = listings.reduce<string | null>((acc, l) => (!acc || l.updatedAt > acc ? l.updatedAt : acc), null);

  return (
    <div className="space-y-6">
      <PageHeader
        title={item.title}
        description={
          canMap
            ? `${item.description} Petakan listing ke SKU internal secara otomatis atau manual; Portofolio dihitung per SKU.`
            : item.description
        }
        isDemo={organization.isDemo}
        actions={unmapped > 0 ? <Badge variant="warning">{unmapped} belum dipetakan</Badge> : null}
      />
      <DataSourceLabel
        source={organization.isDemo ? "Seed DEMO" : "Master listing"}
        updatedAt={latest}
        timeZone={organization.timezone}
      />
      {canMap && listings.length > 0 ? (
        <>
          <AutoMapButton unmapped={unmapped} />
          <datalist id="sku-options">
            {skuOptions.map((o) => (
              <option key={o.sku} value={o.sku}>
                {o.name}
              </option>
            ))}
          </datalist>
        </>
      ) : null}
      {listings.length === 0 ? (
        <EmptyState
          icon={Link2}
          title="Belum ada listing"
          description="Listing marketplace masuk saat laporan produk atau Master Listing diimpor dan disimpan."
        />
      ) : (
        <Card className="py-0">
          <CardContent className="px-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Channel</TableHead>
                  <TableHead>Nama listing</TableHead>
                  <TableHead>ID produk / SKU eksternal</TableHead>
                  <TableHead>SKU internal</TableHead>
                  <TableHead className="text-right">Isi / listing</TableHead>
                  {canMap ? <TableHead className="text-right">Pemetaan</TableHead> : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {listings.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell className="whitespace-nowrap">{l.channelName}</TableCell>
                    <TableCell className="max-w-72 truncate" title={l.listingName}>
                      {l.listingName}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {l.externalProductId}
                      {l.externalSkuId ? ` / ${l.externalSkuId}` : ""}
                    </TableCell>
                    <TableCell>
                      {l.mappedSku ? (
                        <span className="font-mono text-xs">{l.mappedSku}</span>
                      ) : (
                        <Badge variant="warning">Belum dipetakan</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{l.unitsPerListing}×</TableCell>
                    {canMap ? (
                      <TableCell className="text-right">
                        <div className="flex justify-end">
                          <ListingMapEditor
                            key={`${l.mappedSku}-${l.unitsPerListing}`}
                            listingId={l.id}
                            listingName={l.listingName}
                            mappedSku={l.mappedSku}
                            unitsPerListing={l.unitsPerListing}
                          />
                        </div>
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
