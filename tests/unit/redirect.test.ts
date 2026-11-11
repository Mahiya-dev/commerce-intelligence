import { describe, expect, it } from "vitest";
import { safeRedirectPath, DEFAULT_AUTHENTICATED_PATH } from "@/lib/auth/redirect";

describe("safeRedirectPath (open-redirect protection)", () => {
  it.each([
    ["/ecommerce", "/ecommerce"],
    ["/ecommerce?channel=shopee#top", "/ecommerce?channel=shopee#top"],
    ["/master-data/products", "/master-data/products"],
  ])("accepts same-origin path %s", (input, expected) => {
    expect(safeRedirectPath(input)).toBe(expected);
  });

  it.each([
    ["https://evil.com"],
    ["//evil.com"],
    ["/\\evil.com"],
    ["javascript:alert(1)"],
    ["evil.com/path"],
    [""],
    ["   "],
    ["/login"],
    ["/auth/callback?code=x"],
    ["/ok\u0000"],
    ["/" + "a".repeat(600)],
  ])("rejects %s", (input) => {
    expect(safeRedirectPath(input)).toBe(DEFAULT_AUTHENTICATED_PATH);
  });

  it("rejects non-strings and honours a custom fallback", () => {
    expect(safeRedirectPath(undefined)).toBe(DEFAULT_AUTHENTICATED_PATH);
    expect(safeRedirectPath(42, "/account/set-password")).toBe("/account/set-password");
  });
});
