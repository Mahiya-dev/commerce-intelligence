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

describe("database TLS (DB_SSL)", () => {
  const base = { DB_HOST: "db.example.test", DB_USER: "u", DB_PASSWORD: "p", DB_NAME: "d" };

  it("is off by default (cPanel localhost)", () => {
    expect(parseDatabaseConfig(base).ssl).toBeUndefined();
    expect(parseDatabaseConfig({ ...base, DB_SSL: "false" }).ssl).toBeUndefined();
  });

  it("enables verified TLS, with an optional provider CA (\\n-escaped PEM)", () => {
    expect(parseDatabaseConfig({ ...base, DB_SSL: "true" }).ssl).toEqual({
      rejectUnauthorized: true,
      minVersion: "TLSv1.2",
    });
    const ca = parseDatabaseConfig({
      ...base,
      DB_SSL: "true",
      DB_SSL_CA: "-----BEGIN CERTIFICATE-----\\nABC\\n-----END CERTIFICATE-----",
    }).ssl?.ca;
    expect(ca).toBe("-----BEGIN CERTIFICATE-----\nABC\n-----END CERTIFICATE-----");
    expect(parseDatabaseConfig({ DATABASE_URL: "mysql://u:p@h:4000/d", DB_SSL: "1" }).ssl?.rejectUnauthorized).toBe(
      true,
    );
  });

  it("rejects an unclear value", () => {
    expect(() => parseDatabaseConfig({ ...base, DB_SSL: "yes" })).toThrow(/DB_SSL/);
  });
});
