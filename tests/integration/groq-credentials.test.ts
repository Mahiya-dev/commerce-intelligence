import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seedDemo } from "@/lib/master-data/demo-seed";
import { AuthorizationError } from "@/lib/data/master-data";
import { queryOne, queryRows } from "@/lib/db/pool";
import type { ActiveSession } from "@/lib/auth/sessions";
import {
  getGroqApiKey,
  getGroqCredentialStatus,
  removeGroqCredential,
  saveGroqCredential,
} from "@/lib/organization/ai-credentials";
import { sessionFor, setupTestDatabase } from "./helpers";

// Test-only values; Groq is never contacted (fetch is stubbed).
const KEY_A = "gsk_test_AAAAAAAAAAAAAAAA1111";
const KEY_B = "gsk_test_BBBBBBBBBBBBBBBB2222";
const models = (status = 200) =>
  (async () =>
    new Response(JSON.stringify({ data: [{ id: "model-a" }, { id: "model-b" }] }), {
      status,
    })) as unknown as typeof fetch;

let teardown: () => Promise<void>;
let owner: ActiveSession;
let admin: ActiveSession;
let analyst: ActiveSession;
const previousKey = process.env.APP_ENCRYPTION_KEY;
const userId = async (email: string) =>
  (await queryOne<{ id: string }>("SELECT id FROM users WHERE email = ?", [email]))!.id;

beforeAll(async () => {
  process.env.APP_ENCRYPTION_KEY = randomBytes(32).toString("base64");
  ({ teardown } = await setupTestDatabase("groq"));
  await seedDemo({ withUsers: true });
  owner = await sessionFor(await userId("owner.demo@uray.local"));
  admin = await sessionFor(await userId("admin.demo@uray.local"));
  analyst = await sessionFor(await userId("analyst.demo@uray.local"));
});
afterAll(async () => {
  process.env.APP_ENCRYPTION_KEY = previousKey;
  await teardown();
});

describe("Groq API key", () => {
  it("only the Owner can save it", async () => {
    await expect(
      saveGroqCredential(admin, { apiKey: KEY_A, model: "" }, { fetchImpl: models() }),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("rejects a key Groq does not accept and stores nothing", async () => {
    const r = await saveGroqCredential(owner, { apiKey: KEY_A, model: "" }, { fetchImpl: models(401) });
    expect(r).toMatchObject({ ok: false, field: "apiKey" });
    expect(await getGroqCredentialStatus(admin)).toEqual({ configured: false });
  });

  it("stores the key encrypted; status shows only a hint", async () => {
    const r = await saveGroqCredential(owner, { apiKey: KEY_A, model: "model-a" }, { fetchImpl: models() });
    expect(r).toEqual({ ok: true, hint: "gsk_…1111", models: ["model-a", "model-b"] });

    const raw = await queryOne<{ encrypted_key: string }>("SELECT encrypted_key FROM organization_ai_credentials");
    expect(raw!.encrypted_key.startsWith("v1:")).toBe(true);
    expect(raw!.encrypted_key).not.toContain(KEY_A);

    const status = await getGroqCredentialStatus(admin);
    expect(status).toMatchObject({ configured: true, hint: "gsk_…1111", model: "model-a" });
    expect(JSON.stringify(status)).not.toContain(KEY_A);
    expect(await getGroqApiKey(analyst)).toEqual({ apiKey: KEY_A, model: "model-a" });
  });

  it("keeps the stored key when only the model changes; rejects unknown models", async () => {
    expect(await saveGroqCredential(owner, { apiKey: "", model: "model-b" }, { fetchImpl: models() })).toMatchObject({
      ok: true,
    });
    expect(await getGroqApiKey(analyst)).toEqual({ apiKey: KEY_A, model: "model-b" });
    expect(await saveGroqCredential(owner, { apiKey: KEY_B, model: "nope" }, { fetchImpl: models() })).toMatchObject({
      ok: false,
      field: "model",
    });
    expect((await getGroqApiKey(analyst))?.apiKey).toBe(KEY_A);
  });

  it("audit entries never contain the key", async () => {
    await saveGroqCredential(owner, { apiKey: KEY_B, model: "" }, { fetchImpl: models() });
    expect(await removeGroqCredential(owner)).toBe(true);
    expect(await getGroqCredentialStatus(admin)).toEqual({ configured: false });

    const rows = await queryRows<{ action: string; old_data: unknown; new_data: unknown }>(
      "SELECT action, old_data, new_data FROM audit_logs WHERE entity_type = 'ai_credential' ORDER BY id",
    );
    expect(rows.map((r) => r.action)).toEqual([
      "ai_credential.created",
      "ai_credential.updated",
      "ai_credential.updated",
      "ai_credential.removed",
    ]);
    const dump = JSON.stringify(rows);
    expect(dump).not.toContain(KEY_A);
    expect(dump).not.toContain(KEY_B);
  });
});
