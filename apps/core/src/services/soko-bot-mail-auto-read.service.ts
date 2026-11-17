import type { RequestLogger } from "evlog";

import { logCoreWarning } from "@/lib/evlog";
import { messageSafeErrorFields } from "@/lib/safe-error-fields";
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
 * retried: the next check tries again with its own mail. A refusal is a
 * warning on `log`, the caller's event for this check.
 */
export async function autoReadBulkMail(
  sokoBotId: string,
  mail: readonly TriagedMail[],
  log: Pick<RequestLogger, "warn" | "getContext">,
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
      // Only provider, operation and status: the provider's text can quote
      // the mail it refused.
      logCoreWarning(
        log,
        {
          message: "Could not mark a Soko Bot owner's bulk mail as read",
          why: `${integration.provider.name} rejected marking the mail as read`,
          fix: "The next mail check tries again. If it keeps failing, ask the owner to reconnect the mailbox so it grants the modify scope.",
        },
        // An array: evlog concatenates it across warnings on the same event,
        // so every refusing mailbox keeps its own provider and count.
        {
          mailAutoReadFailures: [
            {
              sokoBotId,
              provider,
              messages: ids.length,
              ...messageSafeErrorFields(error),
            },
          ],
        },
      );
    }
  }
  return result;
}
