import type { Metadata } from "next";
import { Boxes, Lock } from "lucide-react";
import { requireRole } from "@/lib/auth/guards";
import { can } from "@/lib/auth/roles";
import { requireNavItem } from "@/config/navigation";
import { listProductsWithVariants, type ProductView } from "@/lib/data/master-data";
import { formatIDR, MISSING } from "@/lib/format";
import { PageHeader } from "@/components/shared/page-header";
import { DataSourceLabel } from "@/components/shared/data-source-label";
import { EmptyState } from "@/components/shared/empty-state";
import { DemoBadge } from "@/components/shared/demo-badge";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const metadata: Metadata = { title: "Master Produk" };

const STATUS_LABEL = { active: "Aktif", inactive: "Nonaktif", discontinued: "Dihentikan" } as const;

export default async function ProductsPage() {
  const item = requireNavItem("/master-data/products");
  const session = await requireRole(item.minRole);
  const { organization } = session;
  const showCogs = can(session.role, "cogs:view");
  const products = await listProductsWithVariants(session, { includeCogs: showCogs });
  const latest = products.reduce<string | null>((acc, p) => (!acc || p.updatedAt > acc ? p.updatedAt : acc), null);

  return (
    <div className="space-y-6">
      <PageHeader title={item.title} description={item.description} isDemo={organization.isDemo} />
      <DataSourceLabel
        source={organization.isDemo ? "Seed DEMO" : "Master produk"}
        updatedAt={latest}
        timeZone={organization.timezone}
      />
      {products.length === 0 ? (
        <EmptyState
          icon={Boxes}
          title="Belum ada produk"
          description="Master produk akan diisi melalui impor (Fase 2) atau oleh admin."
        />
      ) : (
        <Card className="py-0">
          <CardContent className="px-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Kode / SKU</TableHead>
                  <TableHead>Nama</TableHead>
                  <TableHead>Tipe</TableHead>
                  <TableHead>Ukuran</TableHead>
                  <TableHead className="text-right">Standard COGS</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {products.map((p) => (
                  <ProductRows key={p.id} product={p} showCogs={showCogs} />
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function ProductRows({ product, showCogs }: { product: ProductView; showCogs: boolean }) {
  return (
    <>
      <TableRow className="bg-muted/40 hover:bg-muted/40">
        <TableCell className="font-mono text-xs font-semibold">{product.code}</TableCell>
        <TableCell className="font-medium">
          <span className="inline-flex items-center gap-2">
            {product.name}
            {product.isDemo ? <DemoBadge /> : null}
          </span>
        </TableCell>
        <TableCell>
          <Badge variant={product.productType === "bundle" ? "secondary" : "outline"}>
            {product.productType === "bundle" ? "Bundle" : "Satuan"}
          </Badge>
        </TableCell>
        <TableCell className="text-muted-foreground">{product.category ?? MISSING}</TableCell>
        <TableCell />
        <TableCell>{STATUS_LABEL[product.status]}</TableCell>
      </TableRow>
      {product.variants.map((v) => (
        <TableRow key={v.id}>
          <TableCell className="pl-8 font-mono text-xs">{v.sku}</TableCell>
          <TableCell className="text-muted-foreground">{v.name}</TableCell>
          <TableCell />
          <TableCell className="tabular-nums">
            {v.sizeValue !== null ? `${v.sizeValue} ${v.sizeUnit}` : MISSING}
          </TableCell>
          <TableCell className="text-right tabular-nums">
            {!showCogs ? (
              <span className="inline-flex items-center gap-1 text-muted-foreground" title="Hanya Analyst ke atas">
                <Lock className="size-3" aria-hidden />
                Terbatas
              </span>
            ) : v.standardCogs !== null ? (
              formatIDR(v.standardCogs)
            ) : product.productType === "bundle" ? (
              "Dihitung dari komponen"
            ) : (
              MISSING
            )}
          </TableCell>
          <TableCell>{STATUS_LABEL[v.status]}</TableCell>
        </TableRow>
      ))}
    </>
  );
}
