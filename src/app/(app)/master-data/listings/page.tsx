import type { Metadata } from "next";
import { Link2 } from "lucide-react";
import { requireRole } from "@/lib/auth/guards";
import { requireNavItem } from "@/config/navigation";
import { listChannelListings } from "@/lib/data/master-data";
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
  const listings = await listChannelListings(session);
  const unmapped = listings.filter((l) => !l.mappedSku).length;
  const latest = listings.reduce<string | null>((acc, l) => (!acc || l.updatedAt > acc ? l.updatedAt : acc), null);

  return (
    <div className="space-y-6">
      <PageHeader
        title={item.title}
        description={`${item.description} Pengeditan pemetaan tersedia pada Fase 2 bersama alur impor.`}
        isDemo={organization.isDemo}
        actions={unmapped > 0 ? <Badge variant="warning">{unmapped} belum dipetakan</Badge> : null}
      />
      <DataSourceLabel
        source={organization.isDemo ? "Seed DEMO" : "Master listing"}
        updatedAt={latest}
        timeZone={organization.timezone}
      />
      {listings.length === 0 ? (
        <EmptyState
          icon={Link2}
          title="Belum ada listing"
          description="Listing marketplace akan masuk melalui impor (Fase 2)."
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
