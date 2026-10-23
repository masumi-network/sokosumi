import { Prisma } from "@sokosumi/database";
import { getSokoBotIntegrationProvider } from "@sokosumi/soko-bot";

import { getComposio } from "@/clients/composio.client";
import { adProviderForToolkit } from "@/config/ads-providers";
import { getEnv } from "@/config/env";
import { isPrismaRecordNotFoundError } from "@/helpers/prisma";
import { isSharedSokoBot } from "@/helpers/soko-bot-kind";
import { assertSokoBotIntegrationReplace } from "@/helpers/soko-bot-management";
import {
  ME_SOKO_BOT,
  memberSokoBot,
  type SokoBotSelector,
} from "@/helpers/soko-bot-resolver";
import prisma from "@/lib/db/prisma";
import { scheduleContactCapture } from "@/services/contact-capture.service";
import type { SokoBotIntegrationView } from "@/services/soko-bot-integration-list.service";
import {
  composioEntityId,
  requireComposio,
  resolveProvider,
  SokoBotIntegrationError,
  withComposio,
} from "@/services/soko-bot-integrations.service";

async function lookupToolkit(
  slug: string,
): Promise<{ name: string; logoUrl: string | null }> {
  const composio = requireComposio();
  try {
    const toolkit = await withComposio("toolkit", () =>
      composio.toolkits.get(slug),
    );
    return { name: toolkit.name, logoUrl: toolkit.meta?.logo ?? null };
  } catch (error) {
    if (
      error instanceof SokoBotIntegrationError &&
      error.kind === "NOT_FOUND"
    ) {
      return {
        name: getSokoBotIntegrationProvider(slug)?.name ?? slug,
        logoUrl: null,
      };
    }
    throw error;
  }
}

export async function requireBot(
  userId: string,
  workspaceId: string,
  selector: SokoBotSelector = ME_SOKO_BOT,
) {
  const bot = await memberSokoBot(userId, workspaceId, selector);
  if (!bot)
    throw new SokoBotIntegrationError("Soko Bot not found", "NOT_FOUND");
  return bot;
}

/**
 * Ad toolkits use the auth config Project Ads uses (our own OAuth apps) and
 * are refused without it; others use a Composio-managed one, created on first use.
 */
async function resolveAuthConfigId(toolkit: string): Promise<string> {
  const adProvider = adProviderForToolkit(toolkit);
  if (adProvider) {
    const authConfigId = getEnv()[adProvider.authConfigEnv];
    if (!authConfigId) {
      throw new SokoBotIntegrationError(
        `${adProvider.name} connections are not configured on this environment`,
        "NOT_CONFIGURED",
      );
    }
    return authConfigId;
  }
  const composio = requireComposio();
  const existing = await composio.authConfigs.list({ toolkit });
  const managed = existing.items.find(
    (item) =>
      item.toolkit.slug.toLowerCase() === toolkit && item.isComposioManaged,
  );
  if (managed) return managed.id;
  const created = await composio.authConfigs.create(toolkit, {
    type: "use_composio_managed_auth",
    name: `sokosumi-${toolkit}`,
  });
  return created.id;
}

/** Starts OAuth; the owner is sent to `redirectUrl` and comes back to `returnUrl`. */
export async function connectSokoBotIntegration(input: {
  userId: string;
  workspaceId: string;
  provider: string;
  returnUrl: string;
  selector?: SokoBotSelector;
}): Promise<{ redirectUrl: string }> {
  const provider = resolveProvider(input.provider);
  const bot = await requireBot(input.userId, input.workspaceId, input.selector);
  // Resolving proved the caller reaches a shared bot; it has no owner.
  const sharedBot = isSharedSokoBot(bot);
  // Ads auth is env-only: resolve before requireComposio so a missing ads
  // config refuses even when COMPOSIO_API_KEY is unset.
  const authConfigId = await withComposio("auth config", () =>
    resolveAuthConfigId(provider.id),
  );
  const composio = requireComposio();
  const toolkit = await lookupToolkit(provider.id);
  const request = await withComposio("start OAuth", () =>
    composio.connectedAccounts.link(composioEntityId(bot.id), authConfigId, {
      callbackUrl: input.returnUrl,
      // Replacement authorization must coexist with the selected account.
      // Execution always pins the locally stored connected_account_id.
      allowMultiple: true,
    }),
  );
  try {
    if (!request.redirectUrl) {
      throw new SokoBotIntegrationError("Composio returned no redirect URL");
    }
    const supersededAccountId = await prisma.$transaction(async (tx) => {
      // Serialize persistence with bot deletion, then recheck ownership and
      // liveness. No remote calls run while this row lock is held.
      await tx.sokoBot.update({
        where: {
          id: bot.id,
          ...(sharedBot ? {} : { userId: input.userId }),
          workspaceId: input.workspaceId,
          archivedAt: null,
          deletedAt: null,
        },
        data: { updatedAt: new Date() },
        select: { id: true },
      });
      // Finalization and disconnect write this row too. Lock it before
      // deciding which pending account the committed replacement supersedes.
      await tx.$queryRaw`
        SELECT "id" FROM "soko_bot_integration"
        WHERE "sokoBotId" = ${bot.id}::uuid AND "provider" = ${provider.id}
        FOR UPDATE
      `;
      const previous = await tx.sokoBotIntegration.findUnique({
        where: {
          sokoBotId_provider: { sokoBotId: bot.id, provider: provider.id },
        },
        select: {
          composioAccountId: true,
          pendingComposioAccountId: true,
          connectorUserId: true,
        },
      });
      if (previous) {
        await assertSokoBotIntegrationReplace(
          input.userId,
          bot,
          previous.connectorUserId,
          tx,
        );
      }
      await tx.sokoBotIntegration.upsert({
        where: {
          sokoBotId_provider: { sokoBotId: bot.id, provider: provider.id },
        },
        create: {
          sokoBotId: bot.id,
          provider: provider.id,
          name: toolkit.name,
          logoUrl: toolkit.logoUrl,
          composioAccountId: request.id,
          status: "PENDING",
          connectorUserId: input.userId,
        },
        update: {
          // The latest persisted attempt wins. Until it succeeds, keep the selected
          // account and its status usable, even if the owner abandons this flow.
          pendingComposioAccountId: request.id,
          name: toolkit.name,
          logoUrl: toolkit.logoUrl,
        },
      });
      const pending = previous?.pendingComposioAccountId;
      return pending &&
        pending !== previous.composioAccountId &&
        pending !== request.id
        ? pending
        : null;
    });
    if (supersededAccountId) {
      await composio.connectedAccounts
        .delete(supersededAccountId)
        .catch(() => undefined);
    }
    return { redirectUrl: request.redirectUrl };
  } catch (error) {
    // Clean up this new authorization if its response is unusable or its
    // persistence fails, including when bot deletion wins the race.
    await composio.connectedAccounts.delete(request.id).catch(() => undefined);
    throw error;
  }
}

/** After the OAuth round-trip: ask Composio whether the account is live. */
export async function finalizeSokoBotIntegration(input: {
  userId: string;
  workspaceId: string;
  provider: string;
  /**
   * The account Composio just verified for this caller. When set, only that
   * account may be promoted, so a connect attempt that raced in after the
   * verification cannot be promoted on its behalf.
   */
  expectedComposioAccountId?: string;
  selector?: SokoBotSelector;
}): Promise<SokoBotIntegrationView["status"]> {
  const provider = resolveProvider(input.provider);
  const bot = await requireBot(input.userId, input.workspaceId, input.selector);
  const row = await prisma.sokoBotIntegration.findUnique({
    where: { sokoBotId_provider: { sokoBotId: bot.id, provider: provider.id } },
    select: {
      id: true,
      composioAccountId: true,
      pendingComposioAccountId: true,
      connectorUserId: true,
    },
  });
  if (!row) throw new SokoBotIntegrationError("Not connected", "NOT_FOUND");
  const composio = requireComposio();
  const accountId = row.pendingComposioAccountId ?? row.composioAccountId;
  if (
    input.expectedComposioAccountId &&
    input.expectedComposioAccountId !== accountId
  ) {
    throw new SokoBotIntegrationError(
      "Connection changed; retry finalizing OAuth",
    );
  }
  const replacing = accountId !== row.composioAccountId;
  if (replacing) {
    await assertSokoBotIntegrationReplace(
      input.userId,
      bot,
      row.connectorUserId,
    );
  }
  const account = await withComposio("account status", () =>
    composio.connectedAccounts.get(accountId),
  );
  if (
    account.id !== accountId ||
    account.toolkit.slug.toLowerCase() !== provider.id
  ) {
    throw new SokoBotIntegrationError(
      "Composio account does not match the provider",
    );
  }
  const status =
    account.status === "ACTIVE" && !account.isDisabled
      ? "ACTIVE"
      : account.status === "INITIALIZING" || account.status === "INITIATED"
        ? "PENDING"
        : account.status === "REVOKED"
          ? "REVOKED"
          : "FAILED";
  // A failed/pending replacement must not disable the working selection.
  if (row.pendingComposioAccountId && status !== "ACTIVE") return status;
  const updated = await prisma.sokoBotIntegration.updateMany({
    where: {
      id: row.id,
      composioAccountId: row.composioAccountId,
      pendingComposioAccountId: row.pendingComposioAccountId,
    },
    data: {
      status,
      connectedAt: status === "ACTIVE" ? new Date() : undefined,
      lastError:
        status === "FAILED" || status === "REVOKED"
          ? (account.statusReason ?? account.status)
          : null,
      ...(status === "ACTIVE" ? { lastErrorAt: null } : {}),
      ...(replacing
        ? {
            composioAccountId: accountId,
            pendingComposioAccountId: null,
            // The replacement is the finalizing member's account now.
            connectorUserId: input.userId,
            cursor: Prisma.DbNull,
            lastIngestAt: null,
          }
        : {}),
    },
  });
  if (updated.count === 0) {
    throw new SokoBotIntegrationError(
      "Connection changed; retry finalizing OAuth",
    );
  }
  // Contacts start filling from this account: a new account gets a fresh
  // 12-month backfill on the next capture run.
  if (status === "ACTIVE")
    await scheduleContactCapture({
      integrationId: row.id,
      provider: provider.id,
      reset: replacing,
    }).catch((error: unknown) => {
      console.error("Scheduling contact capture failed", {
        integrationId: row.id,
        error: error instanceof Error ? error.message : "unknown",
      });
    });
  // Preserve the existing replacement policy, but only revoke after the new
  // account is active and persisted. Never delete unrelated upstream accounts.
  if (replacing) {
    await composio.connectedAccounts
      .delete(row.composioAccountId)
      .catch(() => undefined);
  }
  return status;
}

/** Any member who reaches the bot may disconnect, whoever connected it. */
export async function disconnectSokoBotIntegration(input: {
  userId: string;
  workspaceId: string;
  provider: string;
  selector?: SokoBotSelector;
}): Promise<void> {
  const provider = resolveProvider(input.provider);
  const bot = await requireBot(input.userId, input.workspaceId, input.selector);
  // Delete-and-return captures the latest IDs atomically. A later connect
  // creates a new row, which this disconnect must not erase after remote I/O.
  const row = await prisma.sokoBotIntegration
    .delete({
      where: {
        sokoBotId_provider: { sokoBotId: bot.id, provider: provider.id },
      },
      select: { composioAccountId: true, pendingComposioAccountId: true },
    })
    .catch((error: unknown) => {
      if (isPrismaRecordNotFoundError(error)) return null;
      throw error;
    });
  if (!row) return;
  const composio = getComposio();
  if (composio) {
    for (const accountId of new Set([
      row.composioAccountId,
      row.pendingComposioAccountId,
    ])) {
      if (accountId)
        await composio.connectedAccounts
          .delete(accountId)
          .catch(() => undefined);
    }
  }
}
