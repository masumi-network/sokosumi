import prisma from "@/lib/db/prisma";
import {
  EVAL_INTEGRATION_PROVIDERS,
  evalIntegrationAccountId,
} from "./eval-integration-world";

const NAMES: Record<(typeof EVAL_INTEGRATION_PROVIDERS)[number], string> = {
  gmail: "Gmail",
  googlecalendar: "Google Calendar",
  googledrive: "Google Drive",
  googlesheets: "Google Sheets",
  github: "GitHub",
  notion: "Notion",
  google_search_console: "Google Search Console",
  google_analytics: "Google Analytics",
};

/**
 * Connects a lane's bot to the eval world's accounts. Each one is ACTIVE and
 * carries an `eval:` account id, so every call on it is answered by the eval
 * world and none reaches Composio. Idempotent: a lane reset may call it again.
 */
export async function seedEvalIntegrations(input: {
  lane: string;
  sokoBotId: string;
  userId: string;
  providers?: readonly (typeof EVAL_INTEGRATION_PROVIDERS)[number][];
}): Promise<void> {
  for (const provider of input.providers ?? EVAL_INTEGRATION_PROVIDERS) {
    const composioAccountId = evalIntegrationAccountId(
      `${input.lane}:${input.sokoBotId}`,
      provider,
    );
    const data = {
      name: NAMES[provider],
      composioAccountId,
      status: "ACTIVE" as const,
      connectorUserId: input.userId,
      connectedAt: new Date(),
      lastError: null,
    };
    await prisma.sokoBotIntegration.upsert({
      where: {
        sokoBotId_provider: { sokoBotId: input.sokoBotId, provider },
      },
      create: { sokoBotId: input.sokoBotId, provider, ...data },
      update: data,
    });
  }
}
