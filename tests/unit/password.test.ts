import { describe, expect, it } from "vitest";
import {
  DUMMY_PASSWORD_HASH,
  generateTemporaryPassword,
  hashPassword,
  needsRehash,
  verifyPassword,
} from "@/lib/auth/password";
import { newPasswordSchema } from "@/lib/auth/schemas";

describe("password hashing (scrypt)", () => {
  it("hashes with a self-describing, salted format and verifies", async () => {
    const a = await hashPassword("RahasiaMadu2026");
    const b = await hashPassword("RahasiaMadu2026");
    expect(a).toMatch(/^scrypt\$32768\$8\$3\$[\w-]+\$[\w-]+$/);
    expect(a).not.toBe(b); // unique salt
    expect(await verifyPassword("RahasiaMadu2026", a)).toBe(true);
    expect(await verifyPassword("rahasiamadu2026", a)).toBe(false);
  });

  it("never verifies the dummy hash or malformed input", async () => {
    expect(await verifyPassword("anything", DUMMY_PASSWORD_HASH)).toBe(false);
    expect(await verifyPassword("x", "bcrypt$whatever")).toBe(false);
    expect(await verifyPassword("x", "scrypt$1$1$1$a$b")).toBe(false);
  });

  it("flags weaker parameters for rehash", () => {
    expect(needsRehash("scrypt$16384$8$1$AAAA$BBBB")).toBe(true);
    expect(needsRehash("garbage")).toBe(true);
  });

  it("generates temporary passwords that satisfy the policy", () => {
    for (let i = 0; i < 50; i++) {
      const pw = generateTemporaryPassword();
      expect(pw).toHaveLength(16);
      expect(newPasswordSchema.safeParse({ password: pw, confirmPassword: pw }).success).toBe(true);
    }
  });
});
