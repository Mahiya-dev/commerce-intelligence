import { resolve } from "node:path";
import mysql, { type Connection } from "mysql2/promise";
import { createPool, setPool, getPool } from "@/lib/db/pool";
import { loadMigrations, runMigrations } from "@/lib/db/migrator";
import { createSession, resolveSession, type ActiveSession } from "@/lib/auth/sessions";

export const MIGRATIONS_DIR = resolve(__dirname, "../../db/migrations");

function base() {
  const user = process.env.TEST_DB_USER;
  if (!user) throw new Error("Set TEST_DB_USER / TEST_DB_PASSWORD (and optionally TEST_DB_HOST, TEST_DB_PORT).");
  return {
    host: process.env.TEST_DB_HOST ?? "localhost",
    port: Number(process.env.TEST_DB_PORT ?? 3306),
    user,
    password: process.env.TEST_DB_PASSWORD ?? "",
  };
}

export async function adminConnection(database?: string): Promise<Connection> {
  return mysql.createConnection({ ...base(), database, multipleStatements: true, timezone: "Z" });
}

/** Creates a fresh database, applies migrations, and points the app pool at it. */
export async function setupTestDatabase(label: string): Promise<{ name: string; teardown: () => Promise<void> }> {
  const name = `uci_test_${label}_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  const admin = await adminConnection();
  await admin.query(`CREATE DATABASE \`${name}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await admin.end();

  const conn = await adminConnection(name);
  await runMigrations(conn, loadMigrations(MIGRATIONS_DIR));
  await conn.end();

  setPool(createPool({ ...base(), database: name, connectionLimit: 5 }));
  return {
    name,
    teardown: async () => {
      await getPool().end();
      setPool(undefined);
      const a = await adminConnection();
      await a.query(`DROP DATABASE IF EXISTS \`${name}\``);
      await a.end();
    },
  };
}

export async function sessionFor(userId: string): Promise<ActiveSession> {
  const { token } = await createSession(userId);
  const state = await resolveSession(token);
  if (state.status !== "active") throw new Error(`User ${userId} has no active session state (${state.status})`);
  return state;
}

/**
 * CHECK violations: MySQL 8 → errno 3819 (ER_CHECK_CONSTRAINT_VIOLATED);
 * MariaDB → errno 4025 (ER_CONSTRAINT_FAILED). mysql2 names errors using
 * MySQL's table, so MariaDB's 4025 gets a misleading code name — match errno.
 */
export const CHECK_VIOLATION = "CHECK_VIOLATION";
const CHECK_ERRNOS = [3819, 4025];

export async function expectDbError(promise: Promise<unknown>, codes: string[]): Promise<void> {
  try {
    await promise;
  } catch (e) {
    const { code = "", errno } = e as { code?: string; errno?: number };
    if (codes.includes(code)) return;
    if (codes.includes(CHECK_VIOLATION) && errno !== undefined && CHECK_ERRNOS.includes(errno)) return;
    throw new Error(`Expected one of ${codes.join(",")} but got ${code}: ${(e as Error).message}`);
  }
  throw new Error(`Expected DB error ${codes.join(",")} but the statement succeeded`);
}
