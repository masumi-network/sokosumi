"use client";

import type { NotificationItem } from "@sokosumi/core-client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useId } from "react";
import { toast } from "sonner";
import { useWorkspaceSwitcher } from "@/app/components/user-avatar/workspace-switcher";
import { useOptionalNotifications } from "@/contexts/notification-provider";
import { useSession } from "@/lib/auth/auth.client";
import { getNotificationIcon } from "@/lib/utils/notification-icon";
import { useNotificationMessage } from "@/lib/utils/notification-message";
import { handleNotificationNavigation } from "@/lib/utils/notification-navigation";

import { WorkspaceColumnPanel } from "./workspace-column-panel";
import {
  WorkspaceColumnProjectAvatar,
  WorkspaceColumnRow,
} from "./workspace-column-row";

/** An open project as a column row shows it, keyed by id. */
export interface ColumnProject {
  name: string;
  logo: string | null;
}

interface NeedsYouPanelListProps {
  notifications: NotificationItem[];
  /** Rendered on the server, so the label cannot differ at hydration. */
  timeLabels: Record<string, string>;
  /** The project a row is about, by notification id. */
  projects: Record<string, ColumnProject>;
  labels: { title: string; empty: string; showAll: string };
  /**
   * Home's quiet list: no panel or border, under the composer like the
   * team's day, and nothing at all when nothing waits.
   */
  quiet?: boolean;
}

/**
 * The Notification Center's Needs you rows, opened the way the Center opens
 * them (switching workspace when the row names another one). Show all opens
 * that view itself.
 */
export function NeedsYouPanelList({
  notifications,
  timeLabels,
  projects,
  labels,
  quiet = false,
}: NeedsYouPanelListProps) {
  const router = useRouter();
  const tCenter = useTranslations("Components.NotificationCenter");
  const tDetail = useTranslations("App.Tasks.Detail");
  const formatMessage = useNotificationMessage();
  const { data: session } = useSession();
  const { handleSelectWorkspace } = useWorkspaceSwitcher();
  const notificationCenter = useOptionalNotifications();
  const activeOrganizationId = session?.session.activeOrganizationId ?? null;
  // Home renders a welcome per breakpoint, so the heading id must be unique.
  const headingId = useId();

  function handleOpen(notification: NotificationItem) {
    if (!notification.isRead && notificationCenter) {
      void notificationCenter.markRead(notification.id).catch(() => {
        toast.error(tCenter("markReadError"));
      });
    }
    void handleNotificationNavigation(
      notification,
      activeOrganizationId,
      router,
      handleSelectWorkspace,
      tDetail,
    );
  }

  const rows = notifications.map((notification) => {
    const project = projects[notification.id];
    const Icon = getNotificationIcon(notification);

    return {
      key: notification.id,
      node: (
        <WorkspaceColumnRow
          leading={
            project ? (
              <WorkspaceColumnProjectAvatar
                name={project.name}
                logo={project.logo}
              />
            ) : (
              <Icon className="text-muted-foreground size-4" aria-hidden />
            )
          }
          title={formatMessage(
            notification.messageKey,
            notification.messageParams ?? {},
          )}
          detail={project?.name}
          time={timeLabels[notification.id] ?? ""}
          target={{ onClick: () => handleOpen(notification) }}
        />
      ),
    };
  });
  const showAll = {
    label: labels.showAll,
    href: "/notifications",
    onClick: () => notificationCenter?.setView("needs-action"),
  };

  if (quiet) {
    if (rows.length === 0) return null;
    return (
      <section aria-labelledby={headingId} data-testid="home-needs-you">
        <div className="flex items-baseline justify-between gap-3 px-3 pb-2">
          <h2 id={headingId} className="text-foreground text-sm font-medium">
            {labels.title}
          </h2>
          <Link
            href={showAll.href}
            onClick={showAll.onClick}
            className="text-muted-foreground hover:text-foreground focus-visible:ring-ring rounded-sm text-sm outline-none transition-colors focus-visible:ring-2"
          >
            {showAll.label}
          </Link>
        </div>
        <ul className="flex flex-col">
          {rows.map((row) => (
            <li key={row.key} data-testid="home-needs-you-row">
              {row.node}
            </li>
          ))}
        </ul>
      </section>
    );
  }

  return (
    <WorkspaceColumnPanel
      testId="workspace-needs-you"
      title={labels.title}
      empty={labels.empty}
      action={{ kind: "link", ...showAll }}
      rows={rows}
    />
  );
}
