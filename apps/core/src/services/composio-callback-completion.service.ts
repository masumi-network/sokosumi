import {
  completeComposioAuth,
  getProjectSocialConnectedAccount,
} from "@/clients/composio.client";
import {
  isProjectSocialProvider,
  PROJECT_SOCIAL_PROVIDERS,
} from "@/config/social-providers";
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
      authConfigId: true,
      callbackRedeemedAt: true,
      expiresAt: true,
      project: { select: { closingAt: true, closedAt: true } },
    },
  });
  if (socialIntent) {
    if (
      socialIntent.initiatingUserId !== input.userId ||
      !isProjectSocialProvider(socialIntent.provider) ||
      socialIntent.callbackRedeemedAt !== null ||
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
    const toolkitSlug =
      PROJECT_SOCIAL_PROVIDERS[socialIntent.provider].toolkitSlug;
    if (
      completion.connectedAccountId !== input.connectionId ||
      completion.toolkitSlug !== toolkitSlug
    ) {
      throw notFound("Unknown or expired connection");
    }
    const account = await getProjectSocialConnectedAccount(input.connectionId);
    if (
      account.id !== input.connectionId ||
      account.toolkitSlug !== toolkitSlug ||
      account.authConfigId !== socialIntent.authConfigId ||
      account.connectorUserId !== projectConnectorUserId(input.userId)
    ) {
      throw notFound("Unknown or expired connection");
    }
    const redeemedAt = new Date();
    const result = await prisma.projectSocialConnectionIntent.updateMany({
      where: {
        connectionId: input.connectionId,
        initiatingUserId: input.userId,
        provider: socialIntent.provider,
        authConfigId: socialIntent.authConfigId,
        callbackRedeemedAt: null,
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

  throw notFound("Unknown or expired connection");
}
