import {
  type HistoryItem,
  NotificationKind,
} from "@/lib/clients/generated/core";
import { getNotificationHref } from "@/lib/utils/notification-href";

/**
 * Destination for a Cmd+K result. Every feed row has one, which is the point:
 * a search hit you cannot open is worse than no hit.
 *
 * Keep this module free of the client directive so Server Components can call
 * it.
 */
export function getHistorySearchItemHref(item: HistoryItem): string {
  // Content Studio, not a notification destination. `NotificationKind` has no
  // IMAGE, and the useful landing place is the studio scoped to that project
  // with that version already open — which is `?projectId=` plus `?v=`, the two
  // params the studio page reads. Without a project there is no gallery to open
  // the version in, so the studio's own project picker is the honest fallback.
  if (item.kind === "image") {
    const version = `v=${encodeURIComponent(item.assetId)}`;
    return item.projectId
      ? `/studio?projectId=${encodeURIComponent(item.projectId)}&${version}`
      : "/studio";
  }

  return getNotificationHref({
    kind: item.kind.toUpperCase() as NotificationKind,
    referenceId: item.id,
    metadata: item.kind === "job" ? { agentId: item.agentId } : null,
  });
}
