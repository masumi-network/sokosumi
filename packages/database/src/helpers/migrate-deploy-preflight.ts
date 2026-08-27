/**
 * Guardrails for Prisma CLI on Vercel (loaded via `prisma.config.ts`).
 *
 * Scoped to DB-MUTATING commands only (`prisma migrate …`, `prisma db …`) —
 * including a raw `prisma migrate deploy`, which loads this config the same
 * way as the package script. Commands that never touch a database
 * (`prisma generate`, run by this package's prepare script during install) are
 * exempt: they have nothing to guard and must not fail builds.
 *
 * For mutating commands:
 * - Preview without a resolvable direct migrate URL: fail closed (avoids
 *   migrating a shared / production DB when Neon preview branching is
 *   misconfigured).
 * - Other Vercel envs without an explicit unpooled URL: warn (Neon DDL via the
 *   pooler often fails; fallback to DATABASE_URL is allowed for non-Neon).
 * - Local / non-Vercel: no-op (use DATABASE_URL as usual).
 */

import {
  type MigrateDatabaseUrlEnv,
  resolveMigrateDatabaseUrl,
} from "./migrate-database-url.js";

export interface MigrateDeployPreflightEnv extends MigrateDatabaseUrlEnv {
  VERCEL?: string;
  VERCEL_ENV?: string;
}

/**
 * True when the Prisma CLI invocation (its argv) is a command that can write
 * to the database: `migrate` (deploy/dev/reset/resolve/…) or `db`
 * (push/execute/seed). Read-only/no-DB commands like `generate`, `validate`,
 * or `format` return false and skip the preflight entirely.
 */
export function isDbMutatingPrismaCommand(argv: readonly string[]): boolean {
  return argv.some((arg) => arg === "migrate" || arg === "db");
}

export type PreflightMessageLevel = "error" | "warn";

export interface PreflightMessage {
  level: PreflightMessageLevel;
  text: string;
}

export interface MigrateDeployPreflightResult {
  ok: boolean;
  messages: PreflightMessage[];
}

const PREVIEW_MISSING_MIGRATE_URL =
  "Preview requires a direct Postgres URL for prisma migrate deploy (DATABASE_URL_UNPOOLED, POSTGRES_URL_NON_POOLING, or a Neon DATABASE_URL from the Vercel Neon integration). Refusing to load Prisma config without one so a misconfigured Preview cannot fall back to a shared or production DATABASE_URL.";

const PREVIEW_DERIVED_UNPOOLED_WARN =
  "DATABASE_URL_UNPOOLED is unset on Preview; deriving a direct Neon URL from DATABASE_URL for prisma migrate deploy. Ensure the Neon integration injects DATABASE_URL_UNPOOLED at build time when possible.";

const VERCEL_MISSING_UNPOOLED_WARN =
  "DATABASE_URL_UNPOOLED is unset on Vercel; prisma migrate deploy will use DATABASE_URL. On Neon, DDL via the pooler often fails — ensure the Neon integration injects DATABASE_URL_UNPOOLED for this environment at build time.";

export function checkMigrateDeployEnv(
  env: MigrateDeployPreflightEnv,
): MigrateDeployPreflightResult {
  const isVercel = env.VERCEL === "1";
  if (!isVercel) {
    return { ok: true, messages: [] };
  }

  const resolved = resolveMigrateDatabaseUrl(env);
  if (env.DATABASE_URL_UNPOOLED?.trim()) {
    return { ok: true, messages: [] };
  }

  if (resolved) {
    const messages: PreflightMessage[] = [];
    if (env.VERCEL_ENV === "preview") {
      if (resolved.source === "neon_derived_from_pooler") {
        messages.push({
          level: "warn",
          text: PREVIEW_DERIVED_UNPOOLED_WARN,
        });
      }
    } else {
      messages.push({
        level: "warn",
        text: VERCEL_MISSING_UNPOOLED_WARN,
      });
    }
    return { ok: true, messages };
  }

  if (env.VERCEL_ENV === "preview") {
    return {
      ok: false,
      messages: [{ level: "error", text: PREVIEW_MISSING_MIGRATE_URL }],
    };
  }

  return {
    ok: true,
    messages: [{ level: "warn", text: VERCEL_MISSING_UNPOOLED_WARN }],
  };
}
