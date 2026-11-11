import { describe, expect, it } from "vitest";
import { ConfigurationError, parseDatabaseConfig } from "@/lib/env";

describe("parseDatabaseConfig", () => {
  it("reads discrete cPanel-style variables with defaults", () => {
    const c = parseDatabaseConfig({ DB_USER: "maduuray_app", DB_PASSWORD: "p@ss:w/rd#1", DB_NAME: "maduuray_uci" });
    expect(c).toMatchObject({
      host: "localhost",
      port: 3306,
      user: "maduuray_app",
      password: "p@ss:w/rd#1",
      database: "maduuray_uci",
      connectionLimit: 5,
    });
  });

  it("parses DATABASE_URL with URL-encoded credentials", () => {
    const c = parseDatabaseConfig({ DATABASE_URL: "mysql://app%40x:p%23ss@db.example.com:3307/uci_prod" });
    expect(c).toMatchObject({
      host: "db.example.com",
      port: 3307,
      user: "app@x",
      password: "p#ss",
      database: "uci_prod",
    });
  });

  it("allows an empty password but not a missing one", () => {
    expect(parseDatabaseConfig({ DB_USER: "u", DB_PASSWORD: "", DB_NAME: "d" }).password).toBe("");
    expect(() => parseDatabaseConfig({ DB_USER: "u", DB_NAME: "d" })).toThrow(ConfigurationError);
  });

  it("lists every missing variable", () => {
    try {
      parseDatabaseConfig({});
      expect.unreachable();
    } catch (e) {
      expect((e as ConfigurationError).issues).toEqual([
        "DB_USER wajib diisi",
        "DB_NAME wajib diisi",
        "DB_PASSWORD wajib diisi",
      ]);
    }
  });

  it("rejects non-mysql URLs and bad ports", () => {
    expect(() => parseDatabaseConfig({ DATABASE_URL: "postgres://u:p@h/d" })).toThrow(ConfigurationError);
    expect(() => parseDatabaseConfig({ DB_USER: "u", DB_PASSWORD: "p", DB_NAME: "d", DB_PORT: "99999" })).toThrow(
      ConfigurationError,
    );
  });

  it("clamps the pool size to a sane range for shared hosting", () => {
    const base = { DB_USER: "u", DB_PASSWORD: "p", DB_NAME: "d" };
    expect(parseDatabaseConfig({ ...base, DB_CONNECTION_LIMIT: "3" }).connectionLimit).toBe(3);
    expect(parseDatabaseConfig({ ...base, DB_CONNECTION_LIMIT: "500" }).connectionLimit).toBe(5);
  });
});
