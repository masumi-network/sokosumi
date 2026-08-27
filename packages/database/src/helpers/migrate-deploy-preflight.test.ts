import { describe, expect, it } from "vitest";

import {
  checkMigrateDeployEnv,
  isDbMutatingPrismaCommand,
} from "./migrate-deploy-preflight.js";

const POOLED =
  "postgresql://user:pass@ep-cool-darkness-123456-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require";

describe("isDbMutatingPrismaCommand", () => {
  it.each([
    ["migrate deploy", ["node", "/x/prisma", "migrate", "deploy"]],
    ["migrate dev", ["node", "/x/prisma", "migrate", "dev"]],
    ["db push", ["node", "/x/prisma", "db", "push"]],
    ["db execute", ["node", "/x/prisma", "db", "execute", "--file", "x.sql"]],
  ])("is true for %s", (_label: string, argv: string[]) => {
    expect(isDbMutatingPrismaCommand(argv)).toBe(true);
  });

  it.each([
    ["generate", ["node", "/x/prisma", "generate"]],
    ["validate", ["node", "/x/prisma", "validate"]],
    ["format", ["node", "/x/prisma", "format"]],
    ["version", ["node", "/x/prisma", "version"]],
  ])("is false for %s", (_label: string, argv: string[]) => {
    expect(isDbMutatingPrismaCommand(argv)).toBe(false);
  });
});

describe("checkMigrateDeployEnv", () => {
  it("is a no-op outside Vercel", () => {
    expect(
      checkMigrateDeployEnv({
        DATABASE_URL_UNPOOLED: undefined,
      }),
    ).toEqual({ ok: true, messages: [] });
  });

  it("allows Vercel when DATABASE_URL_UNPOOLED is set", () => {
    expect(
      checkMigrateDeployEnv({
        VERCEL: "1",
        VERCEL_ENV: "preview",
        DATABASE_URL_UNPOOLED: "postgresql://unpooled.example/db",
      }),
    ).toEqual({ ok: true, messages: [] });

    expect(
      checkMigrateDeployEnv({
        VERCEL: "1",
        VERCEL_ENV: "production",
        DATABASE_URL_UNPOOLED: "  postgresql://unpooled.example/db  ",
      }),
    ).toEqual({ ok: true, messages: [] });
  });

  it("allows Preview when Neon DATABASE_URL can be derived for migrate", () => {
    const result = checkMigrateDeployEnv({
      VERCEL: "1",
      VERCEL_ENV: "preview",
      DATABASE_URL: POOLED,
    });
    expect(result.ok).toBe(true);
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]?.level).toBe("warn");
    expect(result.messages[0]?.text).toMatch(/DATABASE_URL_UNPOOLED is unset/);
  });

  it("allows Preview when POSTGRES_URL_NON_POOLING is set", () => {
    expect(
      checkMigrateDeployEnv({
        VERCEL: "1",
        VERCEL_ENV: "preview",
        POSTGRES_URL_NON_POOLING: "postgresql://legacy/unpooled",
      }),
    ).toEqual({ ok: true, messages: [] });
  });

  it("fails closed on Preview when no migrate URL can be resolved", () => {
    const result = checkMigrateDeployEnv({
      VERCEL: "1",
      VERCEL_ENV: "preview",
    });
    expect(result.ok).toBe(false);
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]?.level).toBe("error");
    expect(result.messages[0]?.text).toMatch(/direct Postgres URL/);

    const localDb = checkMigrateDeployEnv({
      VERCEL: "1",
      VERCEL_ENV: "preview",
      DATABASE_URL: "postgresql://user:pass@localhost:5432/core",
    });
    expect(localDb.ok).toBe(false);
  });

  it("treats blank DATABASE_URL_UNPOOLED as missing on Preview", () => {
    const result = checkMigrateDeployEnv({
      VERCEL: "1",
      VERCEL_ENV: "preview",
      DATABASE_URL_UNPOOLED: "   ",
      DATABASE_URL: POOLED,
    });
    expect(result.ok).toBe(true);
    expect(result.messages[0]?.level).toBe("warn");
  });

  it("warns but allows production when DATABASE_URL_UNPOOLED is missing", () => {
    const result = checkMigrateDeployEnv({
      VERCEL: "1",
      VERCEL_ENV: "production",
    });
    expect(result.ok).toBe(true);
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]?.level).toBe("warn");
    expect(result.messages[0]?.text).toMatch(
      /DATABASE_URL_UNPOOLED is unset on Vercel/,
    );
  });

  it("warns on Vercel without VERCEL_ENV when unpooled is missing", () => {
    const result = checkMigrateDeployEnv({
      VERCEL: "1",
    });
    expect(result.ok).toBe(true);
    expect(result.messages[0]?.level).toBe("warn");
  });
});
