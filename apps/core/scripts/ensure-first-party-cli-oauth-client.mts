#!/usr/bin/env tsx

/**
 * Idempotent seed of the platform-owned Sokosumi CLI OAuth client.
 * Needs DATABASE_URL only. Safe to run on every Core deploy.
 */
import { createPrismaClient } from "@sokosumi/database/client";

import { ensureFirstPartyCliOAuthClient } from "../src/helpers/first-party-cli-oauth-client.js";

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required to seed the CLI OAuth client");
}

const prisma = createPrismaClient(databaseUrl);

try {
  const client = await ensureFirstPartyCliOAuthClient(prisma);
  console.log(`[ensure-cli-oauth] ready clientId=${client.clientId}`);
} finally {
  await prisma.$disconnect();
}
