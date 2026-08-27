import { describe, expect, it } from "vitest";

import {
  deriveNeonUnpooledFromPooled,
  resolveMigrateDatabaseUrl,
} from "./migrate-database-url.js";

const POOLED =
  "postgresql://user:pass@ep-cool-darkness-123456-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require";
const DIRECT =
  "postgresql://user:pass@ep-cool-darkness-123456.us-east-2.aws.neon.tech/neondb?sslmode=require";

describe("deriveNeonUnpooledFromPooled", () => {
  it("removes the -pooler segment from Neon hostnames", () => {
    expect(deriveNeonUnpooledFromPooled(POOLED)).toBe(DIRECT);
  });

  it("returns null for non-Neon or already-direct URLs", () => {
    expect(deriveNeonUnpooledFromPooled(DIRECT)).toBeNull();
    expect(
      deriveNeonUnpooledFromPooled(
        "postgresql://user:pass@localhost:5432/core",
      ),
    ).toBeNull();
  });
});

describe("resolveMigrateDatabaseUrl", () => {
  it("prefers DATABASE_URL_UNPOOLED", () => {
    expect(
      resolveMigrateDatabaseUrl({
        DATABASE_URL_UNPOOLED: "postgresql://explicit/unpooled",
        POSTGRES_URL_NON_POOLING: "postgresql://legacy/unpooled",
        DATABASE_URL: POOLED,
      }),
    ).toEqual({
      url: "postgresql://explicit/unpooled",
      source: "database_url_unpooled",
    });
  });

  it("falls back to POSTGRES_URL_NON_POOLING", () => {
    expect(
      resolveMigrateDatabaseUrl({
        POSTGRES_URL_NON_POOLING: "postgresql://legacy/unpooled",
        DATABASE_URL: POOLED,
      }),
    ).toEqual({
      url: "postgresql://legacy/unpooled",
      source: "postgres_url_non_pooling",
    });
  });

  it("derives unpooled from a Neon pooler DATABASE_URL", () => {
    expect(
      resolveMigrateDatabaseUrl({
        DATABASE_URL: POOLED,
      }),
    ).toEqual({
      url: DIRECT,
      source: "neon_derived_from_pooler",
    });
  });

  it("uses a direct Neon DATABASE_URL when unpooled vars are absent", () => {
    expect(
      resolveMigrateDatabaseUrl({
        DATABASE_URL: DIRECT,
      }),
    ).toEqual({
      url: DIRECT,
      source: "neon_direct_database_url",
    });
  });

  it("returns null when no safe migrate URL is available", () => {
    expect(
      resolveMigrateDatabaseUrl({
        DATABASE_URL: "postgresql://user:pass@localhost:5432/core",
      }),
    ).toBeNull();
    expect(resolveMigrateDatabaseUrl({})).toBeNull();
  });
});
