/**
 * Seeds DEMO master data (+ demo users with --with-users) into a database.
 * Refuses to run when non-demo organizations exist. NEVER run in production.
 *
 *   node dist/cli/seed-demo.cjs [--with-users]
 */
import { parseArgs } from "node:util";
import { getPool } from "@/lib/db/pool";
import { DEMO_PASSWORD, DEMO_USERS, seedDemo } from "@/lib/master-data/demo-seed";
import { fail, loadEnv } from "./_shared";

async function main() {
  loadEnv();
  const { values } = parseArgs({ options: { "with-users": { type: "boolean", default: false } } });
  const { organizationId } = await seedDemo({ withUsers: values["with-users"]! });
  console.log(`✓ Seed DEMO selesai (organisasi ${organizationId})`);
  if (values["with-users"]) {
    console.log(`  Akun demo (password: ${DEMO_PASSWORD}):`);
    for (const u of DEMO_USERS) console.log(`   - ${u.email} (${u.role})`);
  }
  await getPool().end();
}

main().catch(async (e) => {
  await getPool()
    .end()
    .catch(() => undefined);
  fail(e instanceof Error ? e.message : String(e));
});
