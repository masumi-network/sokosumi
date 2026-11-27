import { describe, expect, it } from "vitest";

import {
  checkMigrateDeployEnv,
  isDbMutatingPrismaCommand,
} from "./migrate-deploy-preflight.js";

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

const pooledUrl =
  "postgresql://role:secret@ep-preview-pooler.c-5.us-east-2.aws.neon.tech/db?sslmode=require";
const directUrl = pooledUrl.replace("-pooler", "");
const preview = {
  VERCEL: "1",
  VERCEL_ENV: "preview",
  DATABASE_URL: pooledUrl,
  DATABASE_URL_UNPOOLED: directUrl,
};

describe("checkMigrateDeployEnv", () => {
  it("is a no-op outside Vercel", () => {
    expect(
      checkMigrateDeployEnv({
        DATABASE_URL_UNPOOLED: undefined,
      }),
    ).toEqual({ ok: true, messages: [] });
  });

  it("allows a matching pooled and direct Neon URL on Preview", () => {
    expect(checkMigrateDeployEnv(preview)).toEqual({ ok: true, messages: [] });
  });

  it.each([
    { VERCEL: undefined, VERCEL_ENV: "preview", label: "local" },
    { VERCEL: "1", VERCEL_ENV: "production", label: "production" },
    { VERCEL: "1", VERCEL_ENV: "development", label: "Vercel development" },
    { VERCEL: "1", VERCEL_ENV: undefined, label: "Vercel without a label" },
  ])("keeps the legacy result for $label", ({ VERCEL, VERCEL_ENV }) => {
    expect(
      checkMigrateDeployEnv({
        ...preview,
        VERCEL,
        VERCEL_ENV,
        DATABASE_URL_UNPOOLED: directUrl.replace("ep-preview", "ep-other"),
      }),
    ).toEqual({ ok: true, messages: [] });
    expect(
      checkMigrateDeployEnv({
        ...preview,
        VERCEL,
        VERCEL_ENV,
        DATABASE_URL_UNPOOLED: "  invalid URL  ",
      }),
    ).toEqual({ ok: true, messages: [] });
  });

  it.each([
    [
      "another endpoint",
      directUrl.replace("ep-preview", "ep-other"),
      /same Neon endpoint/,
    ],
    [
      "a pooler in the direct URL",
      pooledUrl,
      /direct host in DATABASE_URL_UNPOOLED/,
    ],
    ["another database", directUrl.replace("/db?", "/other?"), /same database/],
    ["another role", directUrl.replace("role:", "other:"), /same role/],
    ["an invalid URL", "invalid URL", /DATABASE_URL_UNPOOLED must be a valid/],
  ])("refuses %s on Preview", (_label, url, reason) => {
    const result = checkMigrateDeployEnv({
      ...preview,
      DATABASE_URL_UNPOOLED: url,
    });
    expect(result.ok).toBe(false);
    expect(result.messages[0]?.text).toMatch(reason);
    expect(result.messages[0]?.text).toMatch(/Regenerate both URLs/);
  });

  it("refuses a pooled direct URL even when the pooled URL has two pooler suffixes", () => {
    const result = checkMigrateDeployEnv({
      ...preview,
      DATABASE_URL: pooledUrl.replace("-pooler", "-pooler-pooler"),
      DATABASE_URL_UNPOOLED: pooledUrl,
    });
    expect(result.ok).toBe(false);
    expect(result.messages[0]?.text).toMatch(
      /direct host in DATABASE_URL_UNPOOLED/,
    );
  });

  it.each([
    ["DATABASE_URL", "host=ep-other.neon.tech"],
    ["DATABASE_URL_UNPOOLED", "options=endpoint%3Dep-other"],
    ["DATABASE_URL_UNPOOLED", "options=EnDpOiNt%3Dep-other"],
  ] as const)("explains the %s override refusal for %s", (key, query) => {
    expect(
      checkMigrateDeployEnv({
        ...preview,
        [key]: `${preview[key]}&${query}`,
      }),
    ).toEqual({
      ok: false,
      messages: [
        {
          level: "error",
          text: `Preview ${key} must omit host, endpoint, database and role overrides. Regenerate both URLs for this preview branch and redeploy.`,
        },
      ],
    });
  });

  it("keeps the rest of the host when normalizing the endpoint label", () => {
    const result = checkMigrateDeployEnv({
      ...preview,
      DATABASE_URL: directUrl.replace(".c-5.", ".c-5-pooler."),
    });
    expect(result.ok).toBe(false);
    expect(result.messages[0]?.text).toMatch(/same Neon endpoint/);
  });

  it.each([undefined, "invalid URL"])(
    "refuses pooled URL %s on Preview",
    (DATABASE_URL) => {
      const result = checkMigrateDeployEnv({ ...preview, DATABASE_URL });
      expect(result.ok).toBe(false);
      expect(result.messages[0]?.text).toMatch(/DATABASE_URL must be a valid/);
    },
  );

  it("fails closed on Preview when DATABASE_URL_UNPOOLED is missing", () => {
    const result = checkMigrateDeployEnv({
      VERCEL: "1",
      VERCEL_ENV: "preview",
    });
    expect(result.ok).toBe(false);
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]?.level).toBe("error");
    expect(result.messages[0]?.text).toMatch(
      /Preview requires DATABASE_URL_UNPOOLED/,
    );
  });

  it("treats blank DATABASE_URL_UNPOOLED as missing on Preview", () => {
    const result = checkMigrateDeployEnv({
      VERCEL: "1",
      VERCEL_ENV: "preview",
      DATABASE_URL_UNPOOLED: "   ",
    });
    expect(result.ok).toBe(false);
    expect(result.messages[0]?.level).toBe("error");
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
