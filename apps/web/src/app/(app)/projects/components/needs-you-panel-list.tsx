"use client";

import type { NotificationItem } from "@sokosumi/core-client";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
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
}: NeedsYouPanelListProps) {
  const router = useRouter();
  const tCenter = useTranslations("Components.NotificationCenter");
  const tDetail = useTranslations("App.Tasks.Detail");
  const formatMessage = useNotificationMessage();
  const { data: session } = useSession();
  const { handleSelectWorkspace } = useWorkspaceSwitcher();
  const notificationCenter = useOptionalNotifications();
  const activeOrganizationId = session?.session.activeOrganizationId ?? null;

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

  return (
    <WorkspaceColumnPanel
      testId="workspace-needs-you"
      title={labels.title}
      empty={labels.empty}
      action={{
        kind: "link",
        label: labels.showAll,
        href: "/notifications",
        onClick: () => notificationCenter?.setView("needs-action"),
      }}
      rows={notifications.map((notification) => {
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
      })}
    />
  );
}
