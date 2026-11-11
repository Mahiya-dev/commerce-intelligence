/**
 * Database migrations for MySQL / MariaDB.
 *
 *   node dist/cli/migrate.cjs            apply pending migrations
 *   node dist/cli/migrate.cjs --status   show applied / pending
 *   node dist/cli/migrate.cjs --bundle out.sql
 *       write one SQL file for phpMyAdmin → Import (no DB connection needed)
 *
 * Options: --dir <path> (default: db/migrations)
 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import mysql from "mysql2/promise";
import { getDatabaseConfig, ConfigurationError } from "@/lib/env";
import { buildImportBundle, loadMigrations, planMigrations, runMigrations } from "@/lib/db/migrator";
import { fail, loadEnv } from "./_shared";

async function main() {
  const { values } = parseArgs({
    options: {
      dir: { type: "string", default: "db/migrations" },
      status: { type: "boolean", default: false },
      bundle: { type: "string" },
    },
  });
  const files = loadMigrations(resolve(process.cwd(), values.dir!));

  if (values.bundle) {
    const out = resolve(process.cwd(), values.bundle);
    writeFileSync(out, buildImportBundle(files));
    console.log(`✓ Bundle ${files.length} migrasi ditulis ke ${out}`);
    return;
  }

  loadEnv();
  let config;
  try {
    config = getDatabaseConfig();
  } catch (e) {
    fail(e instanceof ConfigurationError ? e.message : String(e));
  }
  const conn = await mysql.createConnection({ ...config, multipleStatements: true, timezone: "Z" });
  try {
    if (values.status) {
      const plan = await planMigrations(conn, files);
      console.log(`Database: ${config.database}`);
      for (const v of plan.applied) console.log(`  ✓ ${v}`);
      for (const f of plan.pending) console.log(`  … ${f.version} (pending)`);
      for (const v of plan.unknown) console.log(`  ⚠ ${v} (tercatat, file tidak ada)`);
      return;
    }
    const applied = await runMigrations(conn, files, (m) => console.log(m));
    console.log(applied.length ? `✓ ${applied.length} migrasi diterapkan` : "✓ Database sudah terbaru");
  } finally {
    await conn.end();
  }
}

main().catch((e) => fail(e instanceof Error ? e.message : String(e)));
