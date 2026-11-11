import { describe, expect, it } from "vitest";
import { isPublicPath } from "@/lib/http/public-paths";

describe("public paths", () => {
  it.each(["/login", "/api/health"])("%s is public", (p) => {
    expect(isPublicPath(p)).toBe(true);
  });

  it.each(["/", "/dashboard", "/settings/members", "/loginx", "/api/other", "/account/password"])(
    "%s requires a session",
    (p) => {
      expect(isPublicPath(p)).toBe(false);
    },
  );
});
