import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret, secretHint, SecretBoxError } from "@/lib/crypto/secret-box";
import { getEncryptionKey } from "@/lib/env";
import { GROQ_API_BASE, verifyGroqKey } from "@/lib/ai/groq";
import { groqCredentialSchema } from "@/lib/organization/ai-credentials";

const FAKE_KEY = "gsk_test_0123456789abcdefWXYZ";

describe("secret box (AES-256-GCM)", () => {
  const key = randomBytes(32);

  it("round-trips and never stores the plaintext", () => {
    const box = encryptSecret(FAKE_KEY, key, "org:a:groq");
    expect(box.startsWith("v1:")).toBe(true);
    expect(box).not.toContain(FAKE_KEY);
    expect(decryptSecret(box, key, "org:a:groq")).toBe(FAKE_KEY);
    expect(encryptSecret(FAKE_KEY, key, "org:a:groq")).not.toBe(box); // random IV
  });

  it("fails with another key, another context, or tampered data", () => {
    const box = encryptSecret(FAKE_KEY, key, "org:a:groq");
    expect(() => decryptSecret(box, randomBytes(32), "org:a:groq")).toThrow(SecretBoxError);
    expect(() => decryptSecret(box, key, "org:b:groq")).toThrow(SecretBoxError);
    const raw = Buffer.from(box.slice(3), "base64");
    raw[raw.length - 1] ^= 1;
    expect(() => decryptSecret(`v1:${raw.toString("base64")}`, key, "org:a:groq")).toThrow(SecretBoxError);
  });

  it("hints never reveal the middle of the secret", () => {
    expect(secretHint(FAKE_KEY)).toBe("gsk_…WXYZ");
    expect(secretHint("short")).toBe("…");
  });
});

describe("APP_ENCRYPTION_KEY parsing", () => {
  it("accepts 32-byte base64 or hex and rejects anything else", () => {
    const k = randomBytes(32);
    expect(getEncryptionKey({ APP_ENCRYPTION_KEY: k.toString("base64") })?.equals(k)).toBe(true);
    expect(getEncryptionKey({ APP_ENCRYPTION_KEY: k.toString("hex") })?.equals(k)).toBe(true);
    expect(getEncryptionKey({ APP_ENCRYPTION_KEY: randomBytes(16).toString("base64") })).toBeNull();
    expect(getEncryptionKey({ APP_ENCRYPTION_KEY: "not a key" })).toBeNull();
    expect(getEncryptionKey({})).toBeNull();
  });
});

describe("verifyGroqKey", () => {
  const respond = (status: number, body: unknown = {}) =>
    (async (url: RequestInfo | URL, init?: RequestInit) => {
      expect(String(url)).toBe(`${GROQ_API_BASE}/models`);
      expect(new Headers(init?.headers).get("authorization")).toBe(`Bearer ${FAKE_KEY}`);
      return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    }) as unknown as typeof fetch;

  it("returns active model ids for a valid key", async () => {
    const body = { object: "list", data: [{ id: "model-b" }, { id: "model-a" }, { id: "old", active: false }] };
    expect(await verifyGroqKey(FAKE_KEY, { fetchImpl: respond(200, body) })).toEqual({
      ok: true,
      models: ["model-a", "model-b"],
    });
  });

  it.each([
    [401, "invalid_key"],
    [403, "invalid_key"],
    [429, "rate_limited"],
    [500, "error"],
  ])("maps HTTP %i to %s", async (status, reason) => {
    expect(await verifyGroqKey(FAKE_KEY, { fetchImpl: respond(status) })).toMatchObject({ ok: false, reason });
  });

  it("reports network failures as unreachable", async () => {
    const boom = (async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;
    expect(await verifyGroqKey(FAKE_KEY, { fetchImpl: boom })).toEqual({ ok: false, reason: "unreachable" });
  });
});

describe("groqCredentialSchema", () => {
  it("allows an empty key (keep stored key) and validates format", () => {
    expect(groqCredentialSchema.safeParse({ apiKey: "", model: "" }).success).toBe(true);
    expect(groqCredentialSchema.safeParse({ apiKey: `  ${FAKE_KEY}  `, model: "model-a" }).data).toEqual({
      apiKey: FAKE_KEY,
      model: "model-a",
    });
    expect(groqCredentialSchema.safeParse({ apiKey: "has spaces in it 123456", model: "" }).success).toBe(false);
    expect(groqCredentialSchema.safeParse({ apiKey: "short", model: "" }).success).toBe(false);
    expect(groqCredentialSchema.safeParse({ apiKey: "", model: "bad model!" }).success).toBe(false);
  });
});
