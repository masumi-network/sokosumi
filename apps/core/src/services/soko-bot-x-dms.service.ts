import {
  getSokoBotVersion,
  type SokoBotInboxMessage,
  type SokoBotInboxMessageDetail,
  sokoBotReadsXDms,
} from "@sokosumi/soko-bot";
import prisma from "@/lib/db/prisma";
import { type TriagedMail, triageMail } from "@/lib/soko-bot/mail-triage";
import {
  markXDmsSeen,
  X_INBOX_PROVIDER,
  xInboxEntries,
  xInboxMessageDetail,
  xInboxMessages,
  xInboxSeenIds,
} from "@/lib/soko-bot/x-inbox";
import { activeIntegrationsForBot } from "@/services/soko-bot-integrations.service";

export const MAX_X_DMS_PER_PACKET = 40;

/** What a packet with X direct messages tells the bot about them. */
export const X_DM_GUIDE =
  'X direct messages are under their own heading, triaged like mail: brief them under "X messages" the same way. They are the owner\'s private messages: never answer on X yourself; offer to draft a reply in chat instead.';

/**
 * A personal bot's unseen X direct messages (all of the last day for the
 * briefing), from what contact capture kept. A shared bot reads none: they
 * are its connector's private messages.
 */
export async function ownerXDms(
  bot: { id: string; userId: string | null },
  input: { briefing: boolean; since: Date },
): Promise<{
  messages: SokoBotInboxMessage[];
  markSeen: (now: Date) => Promise<void>;
}> {
  const none = { messages: [], markSeen: async () => undefined };
  if (!bot.userId) return none;
  const { versionId } = await prisma.sokoBot.findUniqueOrThrow({
    where: { id: bot.id },
    select: { versionId: true },
  });
  if (!sokoBotReadsXDms(getSokoBotVersion(versionId).skills)) return none;
  const integrations = await activeIntegrationsForBot(
    bot.id,
    "generic",
    X_INBOX_PROVIDER,
  );
  const shown = new Map<string, string[]>();
  const messages: SokoBotInboxMessage[] = [];
  for (const integration of integrations) {
    const seen = xInboxSeenIds(integration.cursor);
    const fresh = xInboxMessages(xInboxEntries(integration.cursor), input.since)
      .filter((message) => input.briefing || !seen.has(message.id))
      .slice(0, MAX_X_DMS_PER_PACKET);
    shown.set(
      integration.id,
      fresh.map((message) => message.id),
    );
    messages.push(...fresh);
  }
  return {
    messages: messages
      .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt))
      .slice(0, MAX_X_DMS_PER_PACKET),
    markSeen: async (now) => {
      for (const [id, ids] of shown) {
        await markXDmsSeen(id, ids);
        await prisma.sokoBotIntegration.update({
          where: { id },
          data: { lastIngestAt: now },
        });
      }
    },
  };
}

/** Jev tags DMs like mail; the owner's mail rules never act on them. */
export async function triageXDms(
  sokoBotId: string,
  messages: readonly SokoBotInboxMessage[],
  source: "briefing" | "delta" | "standup",
): Promise<TriagedMail[]> {
  if (messages.length === 0) return [];
  const triage = await triageMail({ sokoBotId, mail: messages, source });
  triage.log.set({ xDms: true });
  triage.log.emit();
  return triage.mail.map((item) => ({ ...item, matchesRule: false }));
}

/** The owner's kept X DMs as search_inbox lists them, newest first. */
export async function searchXDms(
  sokoBotId: string,
  input: { query?: string; since?: Date; limit: number },
): Promise<SokoBotInboxMessage[]> {
  const words = (input.query ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  const integrations = await activeIntegrationsForBot(
    sokoBotId,
    "generic",
    X_INBOX_PROVIDER,
  );
  return integrations
    .flatMap((integration) =>
      xInboxMessages(xInboxEntries(integration.cursor), input.since),
    )
    .filter((message) => {
      const text = `${message.from} ${message.snippet}`.toLowerCase();
      return words.every((word) => text.includes(word));
    })
    .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt))
    .slice(0, input.limit);
}

export async function readXDm(
  sokoBotId: string,
  id: string,
): Promise<SokoBotInboxMessageDetail | null> {
  for (const integration of await activeIntegrationsForBot(
    sokoBotId,
    "generic",
    X_INBOX_PROVIDER,
  )) {
    const detail = xInboxMessageDetail(xInboxEntries(integration.cursor), id);
    if (detail) return detail;
  }
  return null;
}
