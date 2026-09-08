import {
  type HistoryItem,
  type NotificationKind,
} from "@/lib/clients/generated/core";
import { getNotificationHref } from "@/lib/utils/notification-href";

export function getHistoryItemHref(item: HistoryItem): string {
  return getNotificationHref({
    kind: item.kind.toUpperCase() as NotificationKind,
    referenceId: item.id,
    metadata: item.kind === "job" ? { agentId: item.agentId } : null,
  });
}
