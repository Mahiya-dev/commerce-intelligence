import type { Metadata } from "next";
import { requireRole } from "@/lib/auth/guards";
import { requireNavItem } from "@/config/navigation";
import { listMembers } from "@/lib/data/master-data";
import { can, ROLE_LABELS, ROLES } from "@/lib/auth/roles";
import { AddMemberForm, MemberRowActions } from "./member-forms";
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
  const canManage = can(session.role, "members:manage");

  return (
    <div className="space-y-6">
      <PageHeader
        title={item.title}
        description={
          canManage
            ? `${item.description} Tambahkan pengguna yang boleh mengakses dashboard, atur peran, tangguhkan atau cabut aksesnya.`
            : `${item.description} Hanya Owner yang dapat menambah pengguna atau mengubah peran.`
        }
        isDemo={organization.isDemo}
      />
      {canManage ? (
        <Card className="max-w-4xl">
          <CardHeader>
            <CardTitle className="text-sm">Tambah pengguna</CardTitle>
            <CardDescription>
              Email baru dibuatkan akun dengan kata sandi sementara (ditampilkan sekali, wajib diganti saat login
              pertama). Email yang sudah punya akun langsung mendapat akses dengan kata sandinya sendiri.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <AddMemberForm />
          </CardContent>
        </Card>
      ) : null}
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
                {canManage ? <TableHead>Kelola akses</TableHead> : null}
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
                  {canManage ? (
                    <TableCell>
                      {m.userId === session.user.id ? (
                        <span className="text-xs text-muted-foreground">Akun Anda</span>
                      ) : (
                        <MemberRowActions
                          key={`${m.role}-${m.status}`}
                          userId={m.userId}
                          email={m.email}
                          role={m.role}
                          status={m.status}
                        />
                      )}
                    </TableCell>
                  ) : null}
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
