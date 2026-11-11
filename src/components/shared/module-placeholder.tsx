import { CheckCircle2, Construction } from "lucide-react";
import { requireRole } from "@/lib/auth/guards";
import { requireNavItem } from "@/config/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { DataSourceLabel } from "@/components/shared/data-source-label";
import { EmptyState } from "@/components/shared/empty-state";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Placeholder for modules delivered in later phases. Still enforces the
 * route's role requirement server-side so authorization is correct from day 1.
 */
export async function ModulePlaceholder({
  href,
  capabilities,
  dataSources,
}: {
  href: string;
  capabilities: string[];
  dataSources: string;
}) {
  const item = requireNavItem(href);
  const session = await requireRole(item.minRole);

  return (
    <div className="space-y-6">
      <PageHeader
        title={item.title}
        description={item.description}
        phase={item.phase}
        isDemo={session.organization.isDemo}
      />
      <DataSourceLabel source={dataSources} updatedAt={null} />
      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <EmptyState
          icon={Construction}
          title="Modul sedang disiapkan"
          description={`Modul ini akan aktif pada Fase ${item.phase}. Tidak ada angka yang ditampilkan sampai data tervalidasi tersedia — data kosong tidak akan pernah diperlakukan sebagai nol.`}
        />
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Cakupan modul</CardTitle>
            <CardDescription>Kapabilitas yang direncanakan</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2 text-sm">
              {capabilities.map((c) => (
                <li key={c} className="flex gap-2">
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                  <span>{c}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
