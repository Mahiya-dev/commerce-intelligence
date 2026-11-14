/**
 * Seeds DEMO master data (+ demo users with --with-users) into a database.
 * With --with-sales, also imports and commits the DEMO sales CSVs
 * (samples/phase-2 + samples/phase-3, or --samples <dir>) through the real import pipeline.
 * Refuses to run when non-demo organizations exist. NEVER run in production.
 *
 *   node dist/cli/seed-demo.cjs [--with-users] [--with-sales [--samples <dir>]]
 */
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { getPool } from "@/lib/db/pool";
import { DEMO_PASSWORD, DEMO_USERS, seedDemo } from "@/lib/master-data/demo-seed";
import { seedDemoSales } from "@/lib/master-data/demo-sales";
import { fail, loadEnv } from "./_shared";

async function main() {
  loadEnv();
  const { values } = parseArgs({
    options: {
      "with-users": { type: "boolean", default: false },
      "with-sales": { type: "boolean", default: false },
      samples: { type: "string", default: "samples" },
    },
  });
  // Sales are imported as the demo owner, so they need the demo users.
  const withUsers = values["with-users"]! || values["with-sales"]!;
  const { organizationId } = await seedDemo({ withUsers });
  console.log(`✓ Seed DEMO selesai (organisasi ${organizationId})`);
  if (withUsers) {
    console.log(`  Akun demo (password: ${DEMO_PASSWORD}):`);
    for (const u of DEMO_USERS) console.log(`   - ${u.email} (${u.role})`);
  }
  if (values["with-sales"]) {
    const results = await seedDemoSales(resolve(process.cwd(), values.samples!));
    console.log("✓ Data penjualan DEMO:");
    for (const r of results) {
      console.log(`   - ${r.file}: ${r.outcome === "committed" ? "diimpor & disimpan" : "sudah ada (dilewati)"}`);
    }
  }
  await getPool().end();
}

main().catch(async (e) => {
  await getPool()
    .end()
    .catch(() => undefined);
  fail(e instanceof Error ? e.message : String(e));
});
