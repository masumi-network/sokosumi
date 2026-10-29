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

import { ProjectAvatar } from "./project-avatar";
import { WorkspaceColumnPanel } from "./workspace-column-panel";
import { WorkspaceColumnRow } from "./workspace-column-row";

export interface NeedsYouProject {
  name: string;
  logo: string | null;
}

interface NeedsYouPanelListProps {
  notifications: NotificationItem[];
  /** Rendered on the server, so the label cannot differ at hydration. */
  timeLabels: Record<string, string>;
  /** Open projects by id, for the avatar of a row about one. */
  projects: Record<string, NeedsYouProject>;
  labels: { title: string; empty: string; showAll: string };
}

function notificationProjectId(notification: NotificationItem): string | null {
  const projectId = notification.metadata?.projectId;
  return typeof projectId === "string" ? projectId : null;
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
        const projectId = notificationProjectId(notification);
        const project = projectId ? projects[projectId] : undefined;
        const Icon = getNotificationIcon(notification);

        return {
          key: notification.id,
          node: (
            <WorkspaceColumnRow
              leading={
                project ? (
                  <ProjectAvatar
                    name={project.name}
                    logo={project.logo}
                    className="size-4 rounded-sm"
                    fallbackClassName="rounded-sm text-2xs"
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
