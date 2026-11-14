/**
 * User & organization administration (run from cPanel Terminal or locally).
 *
 *   node dist/cli/admin.cjs create-org --name "Madu Uray" --slug madu-uray
 *   node dist/cli/admin.cjs create-user --email a@b.com [--name "Nama"]
 *   node dist/cli/admin.cjs grant --org madu-uray --email a@b.com --role owner|admin|analyst|viewer
 *   node dist/cli/admin.cjs suspend --org madu-uray --email a@b.com
 *   node dist/cli/admin.cjs revoke --org madu-uray --email a@b.com
 *   node dist/cli/admin.cjs reset-password --email a@b.com
 *   node dist/cli/admin.cjs disable-user|enable-user --email a@b.com
 *   node dist/cli/admin.cjs list-users
 *   node dist/cli/admin.cjs purge-sessions
 *   node dist/cli/admin.cjs remove-demo --confirm madu-uray-demo   (hapus SELURUH data & akun DEMO)
 */
import { parseArgs } from "node:util";
import { getPool, queryRows } from "@/lib/db/pool";
import {
  AdminError,
  createOrganization,
  createUser,
  removeMembership,
  resetPassword,
  setMembership,
  setUserStatus,
} from "@/lib/admin/users";
import { purgeExpiredAuthData } from "@/lib/auth/sessions";
import { DemoRemovalRefused, removeDemoData } from "@/lib/master-data/demo-remove";
import { isAppRole } from "@/lib/auth/roles";
import { fail, loadEnv } from "./_shared";

function required(value: string | undefined, flag: string): string {
  if (!value) fail(`Opsi --${flag} wajib diisi.`);
  return value;
}

async function main() {
  loadEnv();
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      name: { type: "string" },
      slug: { type: "string" },
      timezone: { type: "string" },
      email: { type: "string" },
      org: { type: "string" },
      role: { type: "string" },
      confirm: { type: "string" },
    },
  });
  const command = positionals[0];

  switch (command) {
    case "create-org": {
      const id = await createOrganization({
        name: required(values.name, "name"),
        slug: required(values.slug, "slug"),
        timezone: values.timezone,
      });
      console.log(`✓ Organisasi dibuat: ${values.slug} (${id})`);
      break;
    }
    case "create-user": {
      const { email, temporaryPassword } = await createUser({
        email: required(values.email, "email"),
        fullName: values.name,
      });
      console.log(`✓ Pengguna dibuat: ${email}`);
      console.log(`  Password sementara: ${temporaryPassword}`);
      console.log("  Sampaikan secara aman. Pengguna wajib menggantinya saat login pertama.");
      break;
    }
    case "grant": {
      const role = required(values.role, "role");
      if (!isAppRole(role)) fail("Peran harus salah satu dari: viewer, analyst, admin, owner.");
      await setMembership({
        organizationSlug: required(values.org, "org"),
        email: required(values.email, "email"),
        role,
      });
      console.log(`✓ ${values.email} → ${role} di ${values.org}`);
      break;
    }
    case "suspend": {
      const rows = await queryRows<{ role: string }>(
        `SELECT m.role FROM organization_members m JOIN organizations o ON o.id = m.organization_id
           JOIN users u ON u.id = m.user_id WHERE o.slug = ? AND u.email = ?`,
        [required(values.org, "org"), required(values.email, "email").toLowerCase()],
      );
      if (!rows[0] || !isAppRole(rows[0].role)) fail("Keanggotaan tidak ditemukan.");
      await setMembership({
        organizationSlug: values.org!,
        email: values.email!,
        role: rows[0].role,
        status: "suspended",
      });
      console.log(`✓ Keanggotaan ${values.email} ditangguhkan`);
      break;
    }
    case "revoke":
      await removeMembership({ organizationSlug: required(values.org, "org"), email: required(values.email, "email") });
      console.log(`✓ ${values.email} dihapus dari ${values.org}`);
      break;
    case "reset-password": {
      const pw = await resetPassword(required(values.email, "email"));
      console.log(`✓ Password ${values.email} direset. Password sementara: ${pw}`);
      console.log("  Semua sesi pengguna ini telah diakhiri.");
      break;
    }
    case "disable-user":
    case "enable-user":
      await setUserStatus(required(values.email, "email"), command === "disable-user" ? "disabled" : "active");
      console.log(`✓ ${values.email}: ${command === "disable-user" ? "dinonaktifkan (sesi diakhiri)" : "diaktifkan"}`);
      break;
    case "list-users": {
      const rows = await queryRows<{ email: string; status: string; orgs: string | null }>(
        `SELECT u.email, u.status,
                GROUP_CONCAT(CONCAT(o.slug, ':', m.role, IF(m.status = 'active', '', '(suspended)')) ORDER BY o.slug SEPARATOR ', ') AS orgs
           FROM users u
           LEFT JOIN organization_members m ON m.user_id = u.id
           LEFT JOIN organizations o ON o.id = m.organization_id
          GROUP BY u.id, u.email, u.status ORDER BY u.email`,
      );
      for (const r of rows) console.log(`${r.email.padEnd(36)} ${r.status.padEnd(9)} ${r.orgs ?? "-"}`);
      break;
    }
    case "purge-sessions": {
      const r = await purgeExpiredAuthData();
      console.log(`✓ Dihapus: ${r.sessions} sesi kedaluwarsa, ${r.loginAttempts} catatan login lama`);
      break;
    }
    case "remove-demo": {
      const r = await removeDemoData({ confirmSlug: required(values.confirm, "confirm") });
      if (r.status === "not_found") {
        console.log("Tidak ada organisasi DEMO — tidak ada yang dihapus.");
        break;
      }
      const total = Object.values(r.rows).reduce((s, n) => s + n, 0);
      console.log(`✓ Organisasi DEMO dihapus: ${total} baris dari ${Object.keys(r.rows).length} tabel`);
      for (const [table, n] of Object.entries(r.rows)) console.log(`   - ${table}: ${n}`);
      console.log(`✓ Akun demo dihapus: ${r.users.length ? r.users.join(", ") : "-"}`);
      break;
    }
    default:
      fail("Perintah tidak dikenal. Lihat komentar di src/cli/admin.ts untuk daftar perintah.");
  }
  await getPool().end();
}

main().catch(async (e) => {
  await getPool()
    .end()
    .catch(() => undefined);
  fail(
    e instanceof AdminError || e instanceof DemoRemovalRefused ? e.message : e instanceof Error ? e.message : String(e),
  );
});
