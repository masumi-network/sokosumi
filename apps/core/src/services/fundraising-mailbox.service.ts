/**
 * The mailbox the raise writes drafts into: the caller's own Soko Bot's
 * Gmail (or another provider that can create drafts). Kept apart from the
 * pipeline and the outreach so neither has to import the other.
 */
import { memberSokoBot } from "@/helpers/soko-bot-resolver";
import type { FundraisingPipelineDto } from "@/schemas/fundraising.schema";
import {
  type ActiveIntegration,
  activeIntegrationsForBot,
} from "@/services/soko-bot-integrations.service";

interface MailboxActor {
  userId: string;
  workspaceId: string;
}

/** The caller's own bot's mail integration that can write drafts, or null. */
export async function ownerMailboxIntegration(
  actor: MailboxActor,
): Promise<ActiveIntegration | null> {
  const bot = await memberSokoBot(actor.userId, actor.workspaceId, {
    kind: "me",
  });
  if (!bot) return null;
  const integrations = await activeIntegrationsForBot(bot.id, "email");
  return (
    integrations.find(
      (integration) => integration.provider.tools.createDraft,
    ) ?? null
  );
}

export async function ownerMailbox(
  actor: MailboxActor,
): Promise<FundraisingPipelineDto["mailbox"]> {
  const integration = await ownerMailboxIntegration(actor);
  return integration
    ? { provider: integration.provider.name, botId: integration.sokoBotId }
    : null;
}
