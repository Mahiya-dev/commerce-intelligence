import { describe, expect, it } from "vitest";
import { newPasswordSchema, signInSchema } from "@/lib/auth/schemas";

describe("auth schemas", () => {
  it("normalises email to lowercase", () => {
    const r = signInSchema.parse({ email: "Owner@MaduUray.com", password: "x" });
    expect(r.email).toBe("owner@maduuray.com");
  });

  it("rejects invalid email", () => {
    expect(signInSchema.safeParse({ email: "nope", password: "x" }).success).toBe(false);
  });

  it.each(["short1A", "alllowercase123", "ALLUPPERCASE123", "NoDigitsHereAtAll"])(
    "rejects weak password %s",
    (password) => {
      expect(newPasswordSchema.safeParse({ password, confirmPassword: password }).success).toBe(false);
    },
  );

  it("requires matching confirmation", () => {
    const r = newPasswordSchema.safeParse({ password: "GoodPassw0rd", confirmPassword: "GoodPassw0rd!" });
    expect(r.success).toBe(false);
  });

  it("accepts a policy-compliant password", () => {
    expect(newPasswordSchema.safeParse({ password: "GoodPassw0rd", confirmPassword: "GoodPassw0rd" }).success).toBe(
      true,
    );
  });
});
