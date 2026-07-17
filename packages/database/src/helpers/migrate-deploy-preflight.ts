/**
 * Guardrails for Prisma CLI on Vercel (loaded via `prisma.config.ts`).
 *
 * Applies to any command that loads the Prisma config (migrate, generate, …),
 * not only the package `prisma:migrate:deploy` script — so a raw
 * `prisma migrate deploy` on Preview is gated the same way.
 *
 * - Preview without DATABASE_URL_UNPOOLED: fail closed (avoids migrating a
 *   shared / production DB when Neon preview branching is misconfigured).
 * - Other Vercel envs without DATABASE_URL_UNPOOLED: warn (Neon DDL via the
 *   pooler often fails; fallback to DATABASE_URL is allowed for non-Neon).
 * - Local / non-Vercel: no-op (use DATABASE_URL as usual).
 */

export interface MigrateDeployPreflightEnv {
  VERCEL?: string;
  VERCEL_ENV?: string;
  DATABASE_URL_UNPOOLED?: string;
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

const PREVIEW_MISSING_UNPOOLED =
  "Preview requires DATABASE_URL_UNPOOLED (injected by the Vercel Neon integration at build time). Refusing to load Prisma config without it so a misconfigured Preview cannot fall back to a shared or production DATABASE_URL (including raw `prisma migrate deploy`).";

const VERCEL_MISSING_UNPOOLED_WARN =
  "DATABASE_URL_UNPOOLED is unset on Vercel; prisma migrate deploy will use DATABASE_URL. On Neon, DDL via the pooler often fails — ensure the Neon integration injects DATABASE_URL_UNPOOLED for this environment at build time.";

export function checkMigrateDeployEnv(
  env: MigrateDeployPreflightEnv,
): MigrateDeployPreflightResult {
  const isVercel = env.VERCEL === "1";
  if (!isVercel) {
    return { ok: true, messages: [] };
  }

  const unpooled = env.DATABASE_URL_UNPOOLED?.trim();
  if (unpooled) {
    return { ok: true, messages: [] };
  }

  if (env.VERCEL_ENV === "preview") {
    return {
      ok: false,
      messages: [{ level: "error", text: PREVIEW_MISSING_UNPOOLED }],
    };
  }

  return {
    ok: true,
    messages: [{ level: "warn", text: VERCEL_MISSING_UNPOOLED_WARN }],
  };
}
