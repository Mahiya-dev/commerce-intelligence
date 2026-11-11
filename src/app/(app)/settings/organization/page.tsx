import type { Metadata } from "next";
import { requireRole } from "@/lib/auth/guards";
import { requireNavItem } from "@/config/navigation";
import { can } from "@/lib/auth/roles";
import { PageHeader } from "@/components/shared/page-header";
import { DemoNotice } from "@/components/shared/demo-badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata: Metadata = { title: "Organisasi" };

export default async function OrganizationSettingsPage() {
  const item = requireNavItem("/settings/organization");
  const session = await requireRole(item.minRole);
  const { organization, role } = session;

  const rows: [string, string][] = [
    ["Nama", organization.name],
    ["Slug", organization.slug],
    ["Zona waktu", organization.timezone],
    ["Mata uang", organization.currency],
    ["Jenis data", organization.isDemo ? "DEMO (sintetis)" : "Produksi"],
  ];

  return (
    <div className="space-y-6">
      <PageHeader title={item.title} description={item.description} isDemo={organization.isDemo} />
      {organization.isDemo ? <DemoNotice /> : null}
      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle className="text-sm">Profil organisasi</CardTitle>
          <CardDescription>
            {can(role, "organization:manage")
              ? "Pengeditan nama & zona waktu oleh Owner akan tersedia pada fase berikutnya."
              : "Hanya Owner yang dapat mengubah pengaturan organisasi."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="divide-y text-sm">
            {rows.map(([k, v]) => (
              <div key={k} className="grid grid-cols-3 gap-4 py-2.5">
                <dt className="text-muted-foreground">{k}</dt>
                <dd className="col-span-2 font-medium">{v}</dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>
    </div>
  );
}
