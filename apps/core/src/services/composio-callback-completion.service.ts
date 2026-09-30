import {
  completeComposioAuth,
  getComposioConnectedAccount,
} from "@/clients/composio.client";
import {
  isProjectAdProvider,
  PROJECT_AD_PROVIDERS,
} from "@/config/ads-providers";
import {
  isProjectSocialProvider,
  PROJECT_SOCIAL_PROVIDERS,
} from "@/config/social-providers";
import { notFound } from "@/helpers/error";
import prisma from "@/lib/db/prisma";

function projectConnectorUserId(userId: string): string {
  return `sokosumi:user:${userId}`;
}

function providerToolkitSlug(provider: string): string | null {
  if (isProjectSocialProvider(provider)) {
    return PROJECT_SOCIAL_PROVIDERS[provider].toolkitSlug;
  }
  if (isProjectAdProvider(provider)) {
    return PROJECT_AD_PROVIDERS[provider].toolkitSlug;
  }
  return null;
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
  const intent = await prisma.projectSocialConnectionIntent.findUnique({
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
  if (intent) {
    const toolkitSlug = providerToolkitSlug(intent.provider);
    if (
      intent.initiatingUserId !== input.userId ||
      !toolkitSlug ||
      intent.callbackRedeemedAt !== null ||
      intent.expiresAt <= new Date() ||
      intent.project.closingAt ||
      intent.project.closedAt
    ) {
      throw notFound("Unknown or expired connection");
    }

    const completion = await completeComposioAuth({
      sessionUri: input.sessionUri,
      userId: projectConnectorUserId(input.userId),
    });
    if (
      completion.connectedAccountId !== input.connectionId ||
      completion.toolkitSlug !== toolkitSlug
    ) {
      throw notFound("Unknown or expired connection");
    }
    const account = await getComposioConnectedAccount(input.connectionId);
    if (
      account.id !== input.connectionId ||
      account.toolkitSlug !== toolkitSlug ||
      account.authConfigId !== intent.authConfigId ||
      account.connectorUserId !== projectConnectorUserId(input.userId)
    ) {
      throw notFound("Unknown or expired connection");
    }
    const redeemedAt = new Date();
    const result = await prisma.projectSocialConnectionIntent.updateMany({
      where: {
        connectionId: input.connectionId,
        initiatingUserId: input.userId,
        provider: intent.provider,
        authConfigId: intent.authConfigId,
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
