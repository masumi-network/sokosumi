import type { SokoBotInboxMessage } from "@sokosumi/soko-bot";

/** Keep the provider separate from its opaque message ID, as read_email needs. */
export function mailReadReference(
  message: Pick<SokoBotInboxMessage, "provider" | "id">,
): string {
  return `read_email ${JSON.stringify({ provider: message.provider, messageId: message.id })}`;
}
