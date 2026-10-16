import { isPrismaRecordNotFoundError } from "@/helpers/prisma";
import { isSharedSokoBot } from "@/helpers/soko-bot-kind";
import prisma from "@/lib/db/prisma";
import { revokeSokoBotIntegrationAccounts } from "@/services/soko-bot-integrations.service";

/**
 * Disconnects the integrations a member connected on the shared Soko Bots of
 * an Organization they no longer belong to. Personal bots keep theirs. Does
 * nothing while the member is still in the Organization, so a hook that ran
 * after a failed removal cannot disconnect anything. Returns how many it
 * disconnected.
 */
export async function disconnectLeaverSokoBotIntegrations(
  userId: string,
  organizationId: string,
): Promise<number> {
  const member = await prisma.member.findFirst({
    where: { userId, organizationId },
    select: { id: true },
  });
  if (member) return 0;
  const rows = await prisma.sokoBotIntegration.findMany({
    where: {
      connectorUserId: userId,
      sokoBot: { workspace: { organizationId } },
    },
    select: {
      id: true,
      sokoBotId: true,
      sokoBot: { select: { userId: true } },
    },
  });
  let disconnected = 0;
  for (const row of rows) {
    if (!isSharedSokoBot(row.sokoBot)) continue;
    // Delete-and-return captures the latest account ids. A replacement that
    // another member finalized meanwhile changed the connector and stays.
    const deleted = await prisma.sokoBotIntegration
      .delete({
        where: { id: row.id, connectorUserId: userId },
        select: {
          provider: true,
          composioAccountId: true,
          pendingComposioAccountId: true,
        },
      })
      .catch((error: unknown) => {
        if (isPrismaRecordNotFoundError(error)) return null;
        throw error;
      });
    if (!deleted) continue;
    disconnected += 1;
    await revokeSokoBotIntegrationAccounts(row.sokoBotId, [deleted]);
  }
  return disconnected;
}

/**
 * Catches every leave the eager hooks miss: a member who leaves on their own
 * (Better Auth runs no remove-member hook for it), a deleted user, a failed
 * hook. Returns how many integrations it disconnected.
 */
export async function sweepLeaverSokoBotIntegrations(): Promise<number> {
  const rows = await prisma.sokoBotIntegration.findMany({
    where: {
      connectorUserId: { not: null },
      sokoBot: { workspace: { organizationId: { not: null } } },
    },
    select: {
      connectorUserId: true,
      sokoBot: {
        select: {
          userId: true,
          workspace: { select: { organizationId: true } },
        },
      },
    },
  });
  const connectors = new Map<
    string,
    { userId: string; organizationId: string }
  >();
  for (const row of rows) {
    const organizationId = row.sokoBot.workspace.organizationId;
    if (
      !isSharedSokoBot(row.sokoBot) ||
      !row.connectorUserId ||
      !organizationId
    ) {
      continue;
    }
    connectors.set(`${row.connectorUserId}:${organizationId}`, {
      userId: row.connectorUserId,
      organizationId,
    });
  }
  let disconnected = 0;
  for (const connector of connectors.values()) {
    disconnected += await disconnectLeaverSokoBotIntegrations(
      connector.userId,
      connector.organizationId,
    );
  }
  return disconnected;
}

/** For the member removal hooks: the sweep retries whatever this misses. */
export async function disconnectLeaverSokoBotIntegrationsBestEffort(
  userId: string,
  organizationId: string,
): Promise<void> {
  try {
    await disconnectLeaverSokoBotIntegrations(userId, organizationId);
  } catch (error) {
    console.error("Soko Bot leaver integration disconnect failed", {
      userId,
      organizationId,
      error: error instanceof Error ? error.message : "unknown",
    });
  }
}
