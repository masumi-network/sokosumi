import type { TriagedMail } from "@/lib/soko-bot/mail-triage";
import {
  activeIntegrationsForBot,
  modifyInboxMessages,
} from "@/services/soko-bot-integrations.service";

export interface MailAutoReadResult {
  markedRead: number;
  failed: number;
}

/**
 * Marks the unread mail Jev tagged bulk as read, so what stays unread in the
 * owner's mailbox is what Jev found urgent or notable. Untagged mail (Jev was
 * down) is left alone, and a mailbox that refuses the change is logged, not
 * retried: the next check tries again with its own mail.
 */
export async function autoReadBulkMail(
  sokoBotId: string,
  mail: readonly TriagedMail[],
): Promise<MailAutoReadResult> {
  const byProvider = new Map<string, string[]>();
  for (const item of mail) {
    if (item.tag !== "BULK" || !item.message.unread) continue;
    const ids = byProvider.get(item.message.provider) ?? [];
    ids.push(item.message.id);
    byProvider.set(item.message.provider, ids);
  }
  const result: MailAutoReadResult = { markedRead: 0, failed: 0 };
  if (byProvider.size === 0) return result;
  const integrations = await activeIntegrationsForBot(sokoBotId, "email");
  for (const [provider, ids] of byProvider) {
    const integration = integrations.find(
      (row) => row.provider.id === provider,
    );
    if (!integration?.provider.tools.modifyMessages) continue;
    try {
      await modifyInboxMessages(integration, ids, { read: true });
      result.markedRead += ids.length;
    } catch (error) {
      result.failed += ids.length;
      console.warn("[soko-bot-mail] auto-read failed", {
        sokoBotId,
        provider,
        error: error instanceof Error ? error.message : "unknown",
      });
    }
  }
  return result;
}
