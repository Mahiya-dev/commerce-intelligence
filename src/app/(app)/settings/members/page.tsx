import type { Metadata } from "next";
import { requireRole } from "@/lib/auth/guards";
import { requireNavItem } from "@/config/navigation";
import { listMembers } from "@/lib/data/master-data";
import { ROLE_LABELS, ROLES } from "@/lib/auth/roles";
import { formatDateTime, MISSING } from "@/lib/format";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const metadata: Metadata = { title: "Pengguna & Akses" };

export default async function MembersPage() {
  const item = requireNavItem("/settings/members");
  const session = await requireRole(item.minRole);
  const { organization } = session;
  const members = await listMembers(session);

  return (
    <div className="space-y-6">
      <PageHeader
        title={item.title}
        description={`${item.description} Penambahan pengguna & perubahan peran via UI tersedia pada fase berikutnya; sementara gunakan CLI admin (docs/environment.md).`}
        isDemo={organization.isDemo}
      />
      <Card className="py-0">
        <CardContent className="px-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nama</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Peran</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Login terakhir</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.map((m) => (
                <TableRow key={m.userId}>
                  <TableCell className="font-medium">{m.fullName ?? MISSING}</TableCell>
                  <TableCell className="text-muted-foreground">{m.email}</TableCell>
                  <TableCell>
                    <Badge variant={m.role === "owner" ? "default" : "secondary"}>{ROLE_LABELS[m.role].label}</Badge>
                  </TableCell>
                  <TableCell>
                    {m.userStatus === "disabled" ? (
                      <Badge variant="destructive">Akun nonaktif</Badge>
                    ) : m.status === "active" ? (
                      <Badge variant="success">Aktif</Badge>
                    ) : (
                      <Badge variant="outline">Ditangguhkan</Badge>
                    )}
                  </TableCell>
                  <TableCell className="tabular-nums">
                    {m.lastLoginAt ? formatDateTime(m.lastLoginAt, organization.timezone) : "Belum pernah"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      <Card className="max-w-3xl">
        <CardHeader>
          <CardTitle className="text-sm">Matriks peran</CardTitle>
          <CardDescription>Ditegakkan di server aplikasi pada setiap halaman dan setiap akses data.</CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="divide-y text-sm">
            {ROLES.map((r) => (
              <div key={r} className="grid grid-cols-4 gap-4 py-2.5">
                <dt className="font-medium">{ROLE_LABELS[r].label}</dt>
                <dd className="col-span-3 text-muted-foreground">{ROLE_LABELS[r].description}</dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>
    </div>
  );
}
