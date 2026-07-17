import { describe, expect, it } from "vitest";

import { checkMigrateDeployEnv } from "./migrate-deploy-preflight.js";

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

  it("fails closed on Preview when DATABASE_URL_UNPOOLED is missing", () => {
    const result = checkMigrateDeployEnv({
      VERCEL: "1",
      VERCEL_ENV: "preview",
    });
    expect(result.ok).toBe(false);
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]?.level).toBe("error");
    expect(result.messages[0]?.text).toMatch(
      /Preview migrate requires DATABASE_URL_UNPOOLED/,
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
