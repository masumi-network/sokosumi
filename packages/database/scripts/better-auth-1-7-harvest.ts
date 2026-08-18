/**
 * Pre-cutover harvest for Better Auth 1.7 account identity.
 *
 * Safe on 1.6: does not rewrite accountId or add issuer. Optionally refreshes
 * Microsoft tokens so idToken carries `oid`, then reports unmapped rows.
 *
 *   pnpm data-migration:better-auth-1-7-harvest -- --report-only
 *   pnpm data-migration:better-auth-1-7-harvest
 *
 * Hold the 1.7 deploy until a non-report run exits 0.
 */

import "dotenv/config";

import { createPrismaClient } from "../src/client.js";
import {
  applyMicrosoftRefreshToAccount,
  assertIdentitiesReadyForUniqueIndex,
  isHarvestReportOnly,
  resolveAccountIdentity,
} from "../src/helpers/better-auth-1-7-account-identity.js";

const MICROSOFT_TOKEN_URL =
  "https://login.microsoftonline.com/common/oauth2/v2.0/token";

interface HarvestAccount {
  id: string;
  providerId: string;
  accountId: string;
  userId: string;
  idToken: string | null;
  refreshToken: string | null;
}

async function refreshMicrosoftTokens(refreshToken: string): Promise<{
  idToken: string | null;
  refreshToken: string | null;
}> {
  const clientId = process.env.MICROSOFT_CLIENT_ID;
  const clientSecret = process.env.MICROSOFT_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error(
      "MICROSOFT_CLIENT_ID and MICROSOFT_CLIENT_SECRET are required to refresh Microsoft tokens",
    );
  }

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    scope: "openid profile email offline_access",
  });

  const response = await fetch(MICROSOFT_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!response.ok) {
    return { idToken: null, refreshToken: null };
  }

  const payload = (await response.json()) as {
    id_token?: unknown;
    refresh_token?: unknown;
  };
  return {
    idToken: typeof payload.id_token === "string" ? payload.id_token : null,
    refreshToken:
      typeof payload.refresh_token === "string" ? payload.refresh_token : null,
  };
}

async function main(): Promise<void> {
  const reportOnly = isHarvestReportOnly(process.argv);
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required");
  }

  const prisma = createPrismaClient(databaseUrl);
  const accounts = await prisma.$queryRaw<HarvestAccount[]>`
    SELECT
      id,
      "providerId",
      "accountId",
      "userId",
      "idToken",
      "refreshToken"
    FROM account
  `;

  let refreshed = 0;
  if (!reportOnly) {
    for (const account of accounts) {
      const firstPass = resolveAccountIdentity(account);
      if (
        firstPass.status !== "unmapped" ||
        account.providerId !== "microsoft" ||
        !account.refreshToken
      ) {
        continue;
      }

      const tokens = await refreshMicrosoftTokens(account.refreshToken);
      const write = applyMicrosoftRefreshToAccount(account, tokens);
      if (!write) {
        continue;
      }

      await prisma.$executeRaw`
        UPDATE account
        SET "idToken" = ${write.idToken},
            "refreshToken" = ${write.refreshToken},
            "updatedAt" = NOW()
        WHERE id = ${account.id}
      `;
      account.idToken = write.idToken;
      account.refreshToken = write.refreshToken;
      refreshed += 1;
    }
  }

  const identities = accounts.map((account) => resolveAccountIdentity(account));
  const unmapped = identities.filter(
    (identity) => identity.status === "unmapped",
  );

  console.log(
    JSON.stringify(
      {
        reportOnly,
        accounts: accounts.length,
        refreshedMicrosoftIdTokens: refreshed,
        unmapped: unmapped.length,
        unmappedSample: unmapped.slice(0, 20).map((row) => ({
          id: row.id,
          providerId: row.providerId,
          reason: row.reason,
        })),
      },
      null,
      2,
    ),
  );

  if (!reportOnly) {
    assertIdentitiesReadyForUniqueIndex(identities);
  } else if (unmapped.length > 0) {
    process.exitCode = 1;
  }
}

const invokedPath = process.argv[1];
if (invokedPath?.endsWith("better-auth-1-7-harvest.ts")) {
  main().catch((error: unknown) => {
    console.error(
      error instanceof Error ? error.message : "better-auth 1.7 harvest failed",
    );
    process.exitCode = 1;
  });
}
