/**
 * CLI entry for migrate-deploy guardrails. Invoked by package script
 * `prisma:migrate:deploy` before `prisma migrate deploy`.
 */

import { checkMigrateDeployEnv } from "../src/helpers/migrate-deploy-preflight.js";

const result = checkMigrateDeployEnv({
  VERCEL: process.env.VERCEL,
  VERCEL_ENV: process.env.VERCEL_ENV,
  DATABASE_URL_UNPOOLED: process.env.DATABASE_URL_UNPOOLED,
});

for (const message of result.messages) {
  const prefix =
    message.level === "error"
      ? "[prisma migrate deploy] error:"
      : "[prisma migrate deploy] warning:";
  const write = message.level === "error" ? console.error : console.warn;
  write(`${prefix} ${message.text}`);
}

if (!result.ok) {
  process.exitCode = 1;
}
