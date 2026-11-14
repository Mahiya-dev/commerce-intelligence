import mysql, { type Pool, type PoolConnection, type ResultSetHeader, type RowDataPacket } from "mysql2/promise";
import { getDatabaseConfig, type DatabaseConfig } from "@/lib/env";

/**
 * Single connection pool per process. Cached on globalThis so Next.js dev
 * hot-reload does not leak pools. All values are bound with placeholders
 * (`?`) — never interpolate user input into SQL strings.
 *
 * Sessions run in UTC; convert to the organization timezone only for display.
 */
const globalForDb = globalThis as unknown as { __uciPool?: Pool };

export function createPool(config: DatabaseConfig): Pool {
  return mysql.createPool({
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    database: config.database,
    connectionLimit: config.connectionLimit,
    ...(config.ssl ? { ssl: config.ssl } : {}),
    maxIdle: config.connectionLimit,
    idleTimeout: 60_000,
    enableKeepAlive: true,
    waitForConnections: true,
    queueLimit: 100,
    timezone: "Z",
    charset: "utf8mb4_unicode_ci",
    dateStrings: false,
    supportBigNumbers: true,
    bigNumberStrings: true,
    // DECIMAL arrives as string; convert deliberately where needed.
    decimalNumbers: false,
    namedPlaceholders: false,
    multipleStatements: false,
  });
}

export function getPool(): Pool {
  globalForDb.__uciPool ??= createPool(getDatabaseConfig());
  return globalForDb.__uciPool;
}

/** Test/CLI hook: use a specific pool instead of the env-configured one. */
export function setPool(pool: Pool | undefined): void {
  globalForDb.__uciPool = pool;
}

export type Queryable = Pick<Pool, "query" | "execute"> | PoolConnection;

export async function queryRows<T>(sql: string, params: unknown[] = [], db: Queryable = getPool()): Promise<T[]> {
  const [rows] = await db.query<RowDataPacket[]>(sql, params);
  return rows as unknown as T[];
}

export async function queryOne<T>(sql: string, params: unknown[] = [], db: Queryable = getPool()): Promise<T | null> {
  const rows = await queryRows<T>(sql, params, db);
  return rows[0] ?? null;
}

export async function execute(
  sql: string,
  params: unknown[] = [],
  db: Queryable = getPool(),
): Promise<ResultSetHeader> {
  const [result] = await db.query<ResultSetHeader>(sql, params);
  return result;
}

/** Runs `fn` in a transaction; commits on success, rolls back on any error. */
export async function withTransaction<T>(fn: (conn: PoolConnection) => Promise<T>, pool: Pool = getPool()): Promise<T> {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (error) {
    await conn.rollback().catch(() => undefined);
    throw error;
  } finally {
    conn.release();
  }
}

export async function pingDatabase(timeoutMs = 3000): Promise<boolean> {
  try {
    await Promise.race([
      getPool().query("SELECT 1"),
      new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), timeoutMs)),
    ]);
    return true;
  } catch {
    return false;
  }
}

/** Convert a JS Date to a MySQL DATETIME(3) value in UTC. */
export function toSqlDateTime(date: Date): string {
  return date.toISOString().slice(0, 23).replace("T", " ");
}
