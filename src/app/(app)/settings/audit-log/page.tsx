import type { Metadata } from "next";
import { History } from "lucide-react";
import { requireRole } from "@/lib/auth/guards";
import { requireNavItem } from "@/config/navigation";
import { listAuditLogs } from "@/lib/data/master-data";
import { formatDateTime, MISSING } from "@/lib/format";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const metadata: Metadata = { title: "Audit Log" };

const ACTION_LABEL: Record<string, string> = {
  "auth.login": "Login",
  "auth.logout": "Logout",
  "auth.login_failed": "Login gagal",
  "auth.login_throttled": "Login diblokir sementara",
  "user.created": "Pengguna dibuat",
  "user.password_changed": "Ganti password",
  "user.password_reset": "Reset password",
  "user.disabled": "Akun dinonaktifkan",
  "user.enabled": "Akun diaktifkan",
  "member.added": "Anggota ditambahkan",
  "member.updated": "Peran/status diubah",
  "member.removed": "Anggota dihapus",
  "organization.created": "Organisasi dibuat",
};

const isWarning = (action: string) => /(failed|throttled|removed|disabled)$/.test(action);

export default async function AuditLogPage() {
  const item = requireNavItem("/settings/audit-log");
  const session = await requireRole(item.minRole);
  const { organization } = session;
  const logs = await listAuditLogs(session);

  return (
    <div className="space-y-6">
      <PageHeader
        title={item.title}
        description={`${item.description} Menampilkan 50 entri terbaru, termasuk aktivitas akun anggota.`}
        isDemo={organization.isDemo}
      />
      {logs.length === 0 ? (
        <EmptyState
          icon={History}
          title="Belum ada aktivitas"
          description="Login, perubahan akun, keanggotaan dan data master akan tercatat di sini."
        />
      ) : (
        <Card className="py-0">
          <CardContent className="px-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Waktu</TableHead>
                  <TableHead>Aksi</TableHead>
                  <TableHead>Entitas</TableHead>
                  <TableHead>Pelaku</TableHead>
                  <TableHead>IP</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {logs.map((log) => (
                  <TableRow key={log.id}>
                    <TableCell className="whitespace-nowrap tabular-nums">
                      {formatDateTime(log.createdAt, organization.timezone)}
                    </TableCell>
                    <TableCell>
                      <Badge variant={isWarning(log.action) ? "destructive" : "secondary"} title={log.action}>
                        {ACTION_LABEL[log.action] ?? log.action}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{log.entityType}</TableCell>
                    <TableCell className="text-muted-foreground">{log.actor ?? "Sistem / CLI"}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {log.ipAddress ?? MISSING}
                    </TableCell>
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
