import {
  NotificationKind,
  type TransactionHistoryItem,
} from "@sokosumi/core-client";
import { sokoBotConsoleRoute } from "@/lib/soko-bot/constants";
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
      return jobHref(item.jobId, item.agentId);
    // An archived task is a 404 everywhere, so its charge opens nothing.
    case "task":
      return item.taskArchived ? null : taskHref(item.taskId);
    // Content Studio, not a notification destination. The ledger row is about
    // the generation that was charged, not one version of it, so this opens the
    // studio scoped to that project rather than deep-linking a single image.
    // Without a project there is no gallery to open, so the studio's own
    // project picker is the honest fallback.
    case "image":
      return item.projectId
        ? `/studio?projectId=${encodeURIComponent(item.projectId)}`
        : "/studio";
    // A Soko Bot row is the viewer's own bot or a shared bot they asked, which
    // bills the asking member. Open that bot's console; the by-id page sends
    // the viewer's own personal bot on to their assistant page.
    case "sokoBot":
      return sokoBotConsoleRoute(item.sokoBotId);
    // A refund opens what it refunded, the same page as the spend it undid.
    // Other top ups have no page behind them.
    case "topUp":
      if (item.refundedJobId) {
        return jobHref(item.refundedJobId, item.refundedAgentId);
      }
      return item.refundedTaskId ? taskHref(item.refundedTaskId) : null;
    // Coworker seats and unattributed spends are ledger entries with no page
    // behind them. A link to nowhere is worse than no link.
    default:
      return null;
  }
}

function jobHref(jobId: string, agentId: string | null): string | null {
  return getNotificationHref({
    kind: NotificationKind.JOB,
    referenceId: jobId,
    metadata: { agentId },
  });
}

function taskHref(taskId: string): string | null {
  return getNotificationHref({
    kind: NotificationKind.TASK,
    referenceId: taskId,
    metadata: null,
  });
}
