import {
  NotificationKind,
  type TransactionHistoryItem,
} from "@sokosumi/core-client";
import { getNotificationHref } from "@/lib/utils/notification-href";

/**
 * Destination for a Transactions row, or null when the consumption has
 * nothing to open.
 *
 * Keep this module free of the client directive so Server Components can call
 * it.
 */
export function getHistoryItemHref(
  item: TransactionHistoryItem,
): string | null {
  switch (item.kind) {
    case "job":
      return getNotificationHref({
        kind: NotificationKind.JOB,
        referenceId: item.jobId,
        metadata: { agentId: item.agentId },
      });
    case "task":
      return getNotificationHref({
        kind: NotificationKind.TASK,
        referenceId: item.taskId,
        metadata: null,
      });
    // Content Studio, not a notification destination. The ledger row is about
    // the generation that was charged, not one version of it, so this opens the
    // studio scoped to that project rather than deep-linking a single image.
    // Without a project there is no gallery to open, so the studio's own
    // project picker is the honest fallback.
    case "image":
      return item.projectId
        ? `/studio?projectId=${encodeURIComponent(item.projectId)}`
        : "/studio";
    // Coworker seats, Soko Bot usage, top ups and unattributed spends are
    // ledger entries with no page behind them. A link to nowhere is worse than
    // no link.
    default:
      return null;
  }
}
