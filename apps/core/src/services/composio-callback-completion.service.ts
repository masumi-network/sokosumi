import { completeComposioAuth } from "@/clients/composio.client";
import { notFound } from "@/helpers/error";
import prisma from "@/lib/db/prisma";

function projectConnectorUserId(userId: string): string {
  return `sokosumi:user:${userId}`;
}

/**
 * Redeems a one-use Composio callback only for the human who initiated its
 * matching local OAuth flow. The session URI is intentionally never persisted.
 */
export async function completeComposioCallback(input: {
  connectionId: string;
  sessionUri: string;
  userId: string;
}): Promise<void> {
  const socialIntent = await prisma.projectSocialConnectionIntent.findUnique({
    where: { connectionId: input.connectionId },
    select: {
      initiatingUserId: true,
      provider: true,
      expiresAt: true,
      project: { select: { closingAt: true, closedAt: true } },
    },
  });
  if (socialIntent) {
    if (
      socialIntent.initiatingUserId !== input.userId ||
      socialIntent.provider !== "x" ||
      socialIntent.expiresAt <= new Date() ||
      socialIntent.project.closingAt ||
      socialIntent.project.closedAt
    ) {
      throw notFound("Unknown or expired connection");
    }

    const completion = await completeComposioAuth({
      sessionUri: input.sessionUri,
      userId: projectConnectorUserId(input.userId),
    });
    if (completion.connectedAccountId !== input.connectionId) {
      throw notFound("Unknown or expired connection");
    }
    const redeemedAt = new Date();
    const result = await prisma.projectSocialConnectionIntent.updateMany({
      where: {
        connectionId: input.connectionId,
        initiatingUserId: input.userId,
        provider: "x",
        expiresAt: { gt: redeemedAt },
        project: { closingAt: null, closedAt: null },
      },
      data: { callbackRedeemedAt: redeemedAt },
    });
    if (result.count !== 1) {
      throw notFound("Unknown or expired connection");
    }
    return;
  }

  const hermesIntent = await prisma.hermesPendingConnection.findUnique({
    where: { connectionId: input.connectionId },
    select: { userId: true, expiresAt: true },
  });
  if (
    !hermesIntent ||
    hermesIntent.userId !== input.userId ||
    hermesIntent.expiresAt <= new Date()
  ) {
    throw notFound("Unknown or expired connection");
  }

  const completion = await completeComposioAuth({
    sessionUri: input.sessionUri,
    userId: input.userId,
  });
  if (completion.connectedAccountId !== input.connectionId) {
    throw notFound("Unknown or expired connection");
  }
}
