import { describe, expect, it } from "vitest";

import {
  assertLocalDatabaseUrl,
  isLocalDatabaseHost,
} from "../assert-local-database-url.js";

describe("isLocalDatabaseHost", () => {
  it.each([["localhost"], ["127.0.0.1"], ["::1"], [""]])(
    "allows %s",
    (host) => {
      expect(isLocalDatabaseHost(host)).toBe(true);
    },
  );

  it.each([
    ["neon.tech"],
    ["ep-cool-name-123456.us-east-2.aws.neon.tech"],
    ["production.db.example.com"],
    ["db.vercel-storage.com"],
  ])("rejects %s", (host) => {
    expect(isLocalDatabaseHost(host)).toBe(false);
  });
});

describe("assertLocalDatabaseUrl", () => {
  it("allows local postgres URLs", () => {
    expect(() =>
      assertLocalDatabaseUrl(
        "postgresql://sokosumi:sokosumi@localhost:5432/core",
      ),
    ).not.toThrow();
  });

  it("allows loopback IP URLs", () => {
    expect(() =>
      assertLocalDatabaseUrl("postgresql://user:pass@127.0.0.1:5432/db"),
    ).not.toThrow();
  });

  it("rejects neon.tech hosts", () => {
    expect(() =>
      assertLocalDatabaseUrl(
        "postgresql://neondb_owner:secret@ep-foo.neon.tech/neondb",
      ),
    ).toThrow(/refusing to seed non-local database/i);
  });

  it("rejects missing DATABASE_URL", () => {
    expect(() => assertLocalDatabaseUrl(undefined)).toThrow(
      /DATABASE_URL is required/i,
    );
  });

  it("rejects invalid URLs", () => {
    expect(() => assertLocalDatabaseUrl("not-a-url")).toThrow(
      /invalid DATABASE_URL/i,
    );
  });
});
