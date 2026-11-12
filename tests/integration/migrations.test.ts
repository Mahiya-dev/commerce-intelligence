import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildImportBundle, checksum, loadMigrations, planMigrations, runMigrations } from "@/lib/db/migrator";
import { adminConnection, MIGRATIONS_DIR } from "./helpers";

const DB = `uci_test_migr_${Date.now()}`;
const BUNDLE_DB = `${DB}_bundle`;

beforeAll(async () => {
  const a = await adminConnection();
  await a.query(`CREATE DATABASE \`${DB}\`; CREATE DATABASE \`${BUNDLE_DB}\``);
  await a.end();
});

afterAll(async () => {
  const a = await adminConnection();
  await a.query(`DROP DATABASE IF EXISTS \`${DB}\`; DROP DATABASE IF EXISTS \`${BUNDLE_DB}\``);
  await a.end();
});

describe("migration runner", () => {
  it("applies all migrations once, then is a no-op", async () => {
    const files = loadMigrations(MIGRATIONS_DIR);
    const conn = await adminConnection(DB);
    expect(await runMigrations(conn, files)).toEqual(files.map((f) => f.version));
    expect(await runMigrations(conn, files)).toEqual([]);
    const [tables] = await conn.query("SHOW TABLES");
    expect((tables as unknown[]).length).toBe(20); // 19 app tables + schema_migrations
    await conn.end();
  });

  it("re-executing every migration file is harmless (re-runnable DDL)", async () => {
    const conn = await adminConnection(DB);
    for (const f of loadMigrations(MIGRATIONS_DIR)) await conn.query(f.sql);
    const [[row]] = (await conn.query("SELECT COUNT(*) AS n FROM channels")) as unknown as [[{ n: number }]];
    expect(Number(row.n)).toBe(6);
    await conn.end();
  });

  it("refuses to run when an applied migration was edited", async () => {
    const files = loadMigrations(MIGRATIONS_DIR);
    const tampered = files.map((f, i) =>
      i === 0 ? { ...f, sql: f.sql + "\n-- edit", checksum: checksum(f.sql + "\n-- edit") } : f,
    );
    const conn = await adminConnection(DB);
    await expect(planMigrations(conn, tampered)).rejects.toThrow(/checksum berbeda/);
    await conn.end();
  });

  it("checksums ignore CRLF line endings (files edited on Windows)", () => {
    expect(checksum("a\r\nb")).toBe(checksum("a\nb"));
  });

  it("phpMyAdmin bundle imports cleanly and is recognised by the runner", async () => {
    const files = loadMigrations(MIGRATIONS_DIR);
    const conn = await adminConnection(BUNDLE_DB);
    await conn.query(buildImportBundle(files));
    await conn.query(buildImportBundle(files)); // importing twice is safe
    const plan = await planMigrations(conn, files);
    expect(plan.pending).toEqual([]);
    expect(plan.applied).toHaveLength(files.length);
    await conn.end();
  });
});
