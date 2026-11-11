import { NextResponse, connection } from "next/server";
import { isDatabaseConfigured } from "@/lib/env";
import { pingDatabase } from "@/lib/db/pool";

/**
 * Liveness/readiness probe for uptime monitoring. Exposes only booleans —
 * no versions, hostnames or error details.
 */
export async function GET() {
  await connection();
  const databaseConfigured = isDatabaseConfigured();
  const databaseReachable = databaseConfigured ? await pingDatabase() : false;
  const ok = databaseConfigured && databaseReachable;
  return NextResponse.json(
    {
      status: ok ? "ok" : "degraded",
      checks: { databaseConfigured, databaseReachable },
      timestamp: new Date().toISOString(),
    },
    { status: ok ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
