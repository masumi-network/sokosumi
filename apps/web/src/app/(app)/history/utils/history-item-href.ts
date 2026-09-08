import {
  type HistoryItem,
  NotificationKind,
} from "@/lib/clients/generated/core";
import { getNotificationHref } from "@/lib/utils/notification-href";

/**
 * Destination for a History / needs-attention row.
 * Keep this module free of the client directive so Server Components can call it.
 */
export function getHistoryItemHref(item: HistoryItem): string {
  return getNotificationHref({
    kind: item.kind.toUpperCase() as NotificationKind,
    referenceId: item.id,
    metadata: item.kind === "job" ? { agentId: item.agentId } : null,
  });
}
