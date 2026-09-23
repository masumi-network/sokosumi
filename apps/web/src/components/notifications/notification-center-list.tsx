"use client";

import { isNeedsActionNotification } from "@sokosumi/utils";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { useWorkspaceSwitcher } from "@/app/components/user-avatar/workspace-switcher";
import { NotificationsSkeletonRows } from "@/app/notifications/components/notifications-loading-view";
import { NotificationCenterRow } from "@/components/notifications/notification-center-row";
import { NotificationEmptyState } from "@/components/notifications/notification-empty-state";
import { NotificationOlderBoundaryRow } from "@/components/notifications/notification-older-boundary-row";
import { Button } from "@/components/ui/button";
import { useAccountNotice } from "@/contexts/account-notice-provider";
import { useNotifications } from "@/contexts/notification-provider";
import { useSession } from "@/lib/auth/auth.client";
import type { NotificationItem } from "@/lib/clients/generated/core";
import { cn } from "@/lib/utils";
import { useNotificationMessage } from "@/lib/utils/notification-message";
import { handleNotificationNavigation } from "@/lib/utils/notification-navigation";
import { useNotificationTimeFormatter } from "@/lib/utils/notification-time";

interface NotificationCenterListProps {
  /** Called as a row navigates away, so the header panel can close itself. */
  onNavigate?: () => void;
}

/**
 * The Notification Center's list, drawn once for both of its frames.
 *
 * The header panel and the notifications page render this over the same
 * provider state, so the two cannot disagree about which rows exist, what
 * order they are in, or which of them are read. Each frame adds its own
 * chrome around it — a title and a footer in the panel, a card and a page
 * header on the page — and nothing else.
 *
 * Older rows arrive as the reader scrolls: the boundary row at the end asks
 * for the next page as soon as it comes into view, and keeps asking until
 * Core has nothing older left.
 */
export function NotificationCenterList({
  onNavigate,
}: NotificationCenterListProps) {
  const t = useTranslations("Components.NotificationCenter");
  const tDetail = useTranslations("App.Tasks.Detail");
  const router = useRouter();
  const formatMessage = useNotificationMessage();
  const formatTime = useNotificationTimeFormatter();
  const { data: session } = useSession();
  const { handleSelectWorkspace } = useWorkspaceSwitcher();
  const activeOrganizationId = session?.session.activeOrganizationId ?? null;
  const { notice } = useAccountNotice();
  const {
    notifications,
    unreadCount,
    needsActionCount,
    view,
    setView,
    markRead,
    isLoading,
    hasFetchError,
    refetch,
    hasMore,
    olderStatus,
    loadOlder,
  } = useNotifications();
  const [pendingNotificationId, setPendingNotificationId] = useState<
    string | null
  >(null);
  // Read rows stay in the feed so mark-read can roll back. The Unread view
  // only hides them after the fold, which is a lens, not a delete. The set
  // never needs clearing: the All view does not consult it, and an Unread
  // fetch never returns a read row, so a stale id can only ever match a row
  // that is unread again, which the lens shows regardless.
  const [hiddenIds, setHiddenIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );

  const hideRow = useCallback((id: string) => {
    setHiddenIds((current) => {
      if (current.has(id)) return current;
      const next = new Set(current);
      next.add(id);
      return next;
    });
  }, []);

  // Needs you holds rows that asked the reader something. A realtime row
  // that never asked lands in the shared feed all the same, for the bell,
  // and stays out of this view here.
  const visibleNotifications =
    view === "unread"
      ? notifications.filter(
          (notification) =>
            !notification.isRead || !hiddenIds.has(notification.id),
        )
      : view === "needs-action"
        ? notifications.filter((notification) =>
            isNeedsActionNotification(notification.messageKey),
          )
        : notifications;

  const handleNotificationClick = (notification: NotificationItem) => {
    // Immediate paint: pending state + optimistic read. Network and navigation
    // stay off the interaction's critical path for INP.
    setPendingNotificationId(notification.id);
    onNavigate?.();

    if (!notification.isRead) {
      // Navigation goes ahead either way: the reader asked to open the row.
      void markRead(notification.id).catch(() => {
        toast.error(t("markReadError"));
      });
    }

    void handleNotificationNavigation(
      notification,
      activeOrganizationId,
      router,
      handleSelectWorkspace,
      tDetail,
    ).finally(() => {
      setPendingNotificationId((current) =>
        current === notification.id ? null : current,
      );
    });
  };

  // Switching to All takes the empty state away, and the button that asked
  // for it with it. Focus would land on <body>, so it goes to the view
  // strip this frame carries: the control the reader just changed, one
  // Tab away from the rows that arrive. Scoped to the frame the button sits
  // in, because the page and the bell panel can both be open at once.
  const handleShowAll = (trigger: HTMLElement) => {
    const frame = trigger.closest("[data-notification-frame]");
    setView("all");
    requestAnimationFrame(() => {
      frame
        ?.querySelector<HTMLElement>(
          '[data-slot="tabs-trigger"][data-state="active"]',
        )
        ?.focus();
    });
  };

  const oldest = notifications.at(-1);
  // Unread and Needs you both carry a live count of the whole view, not of
  // the loaded page. A 0 means Core has nothing left to page.
  const narrowedCount =
    view === "unread"
      ? unreadCount
      : view === "needs-action"
        ? needsActionCount
        : undefined;
  const showOlderBoundary =
    hasMore && oldest !== undefined && narrowedCount !== 0;

  if (visibleNotifications.length === 0) {
    if (isLoading) {
      return <NotificationsSkeletonRows />;
    }

    if (hasFetchError) {
      return (
        <div className="flex flex-col items-center justify-center gap-3 p-8">
          <p className="text-muted-foreground text-center text-sm">
            {t("fetchError")}
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void refetch()}
          >
            {t("retry")}
          </Button>
        </div>
      );
    }

    // Loaded rows of a narrowed view can leave while Core still has older
    // ones. Keep the older-page boundary so the tab does not say the view
    // is empty and so a failed older load still has a retry.
    if (
      narrowedCount !== undefined &&
      narrowedCount > 0 &&
      showOlderBoundary &&
      oldest
    ) {
      return (
        <NotificationOlderBoundaryRow
          oldestId={oldest.id}
          status={olderStatus}
          onLoad={loadOlder}
        />
      );
    }

    // On Needs you an account notice above the list already gives the frame
    // something to say, and "Nothing needs you" under it would read as a
    // contradiction. The other views do not show the notice.
    if (view === "needs-action" && notice !== null) {
      return null;
    }

    // An empty narrowed list is good news only when the tab's number is 0.
    // Unread and Needs you both use that number, not "did we hide the last
    // loaded row".
    if (narrowedCount !== undefined && narrowedCount > 0) {
      return null;
    }

    return <NotificationEmptyState view={view} onShowAll={handleShowAll} />;
  }

  return (
    <>
      <div className="divide-border divide-y">
        {visibleNotifications.map((notification) => (
          <LeavingRow
            key={notification.id}
            notificationId={notification.id}
            isLeaving={view === "unread" && notification.isRead}
            onDeparted={hideRow}
          >
            <NotificationCenterRow
              notification={notification}
              isPending={pendingNotificationId === notification.id}
              message={formatMessage(
                notification.messageKey,
                notification.messageParams ?? {},
              )}
              timeLabel={formatTime(notification.createdAt)}
              onClick={handleNotificationClick}
            />
          </LeavingRow>
        ))}
      </div>
      {/* Nothing older left means nothing here: the end of the list reads as
          the end, rather than as a list that stopped for a reason. */}
      {showOlderBoundary && oldest ? (
        <NotificationOlderBoundaryRow
          oldestId={oldest.id}
          status={olderStatus}
          onLoad={loadOlder}
        />
      ) : null}
    </>
  );
}

/** How long the collapse takes, matched to the transition below. */
const LEAVE_DURATION_MS = 200;

interface LeavingRowProps {
  notificationId: string;
  /** Whether the row no longer belongs to the view it is drawn in. */
  isLeaving: boolean;
  /** Hide the row in this view after the fold. Does not delete it from the feed. */
  onDeparted: (id: string) => void;
  children: ReactNode;
}

/**
 * A row that leaves the Unread view once it has been read, but not while
 * the reader is still on it.
 *
 * Reading a row in the Unread view makes it a row that view should not
 * show. Dropping it at once would slide the next row under the pointer that
 * just clicked its control, and take the way back with it. So the row waits
 * for the pointer and focus to leave, then folds up and goes. A row marked
 * read from elsewhere, by Mark all read in the header, has nothing on it and
 * goes right away. Putting the row back to unread before leaving it cancels
 * the departure, because the row is no longer leaving.
 */
function LeavingRow({
  notificationId,
  isLeaving,
  onDeparted,
  children,
}: LeavingRowProps) {
  const [isPointerInside, setIsPointerInside] = useState(false);
  const [isFocusInside, setIsFocusInside] = useState(false);
  const isCollapsed = isLeaving && !isPointerInside && !isFocusInside;

  // The hide waits for the fold to finish. A row put back to unread mid
  // fold is no longer collapsed, and the cleanup drops the pending hide.
  useEffect(() => {
    if (!isCollapsed) return;
    const reduceMotion =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduceMotion) {
      onDeparted(notificationId);
      return;
    }
    const timer = window.setTimeout(() => {
      onDeparted(notificationId);
    }, LEAVE_DURATION_MS);

    return () => window.clearTimeout(timer);
  }, [isCollapsed, notificationId, onDeparted]);

  return (
    <div
      data-slot="notification-row"
      className={cn(
        "grid transition-[grid-template-rows,opacity] duration-200 ease-out motion-reduce:transition-none",
        isCollapsed ? "grid-rows-[0fr] opacity-0" : "grid-rows-[1fr]",
      )}
      // A finger is not a pointer that rests on a row: it lifts the moment
      // the tap ends and some browsers never say it left. Only a hovering
      // pointer holds the row; a tapped row folds right after the tap.
      onPointerEnter={(event) => {
        if (event.pointerType !== "touch") setIsPointerInside(true);
      }}
      onPointerLeave={() => setIsPointerInside(false)}
      onFocus={() => setIsFocusInside(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          setIsFocusInside(false);
        }
      }}
    >
      <div className="min-h-0 overflow-hidden">{children}</div>
    </div>
  );
}
