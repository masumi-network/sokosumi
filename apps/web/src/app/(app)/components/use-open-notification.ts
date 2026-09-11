"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

import { useWorkspaceSwitcher } from "@/app/components/user-avatar/workspace-switcher";
import { authClient } from "@/lib/auth/auth.client";
import { handleNotificationNavigation } from "@/lib/utils/notification-navigation";
import type { NotificationTarget } from "@/lib/utils/notification-service-worker";

/**
 * Open what a notification points at: mark it read, then route to it.
 *
 * Shared by the two callers that act on a click, because they mount in
 * different places and must behave the same. The toast listener takes clicks
 * the worker posts to an open tab; the URL opener takes the target a window
 * the worker opened was given, and mounts outside the realtime provider so a
 * cold start does not wait on Ably to route a click.
 *
 * The active organization is read here rather than passed in, because the
 * navigation may switch it and the caller's copy would be a render old.
 */
export function useOpenNotification(markRead: (id: string) => Promise<void>) {
  const tDetail = useTranslations("App.Tasks.Detail");
  const router = useRouter();
  const { handleSelectWorkspace } = useWorkspaceSwitcher();

  return function openNotification(
    target: NotificationTarget,
    isRead: boolean,
  ) {
    void (async () => {
      if (!isRead) {
        void markRead(target.id).catch(() => {
          // Still open the link when mark-read fails.
        });
      }

      const sessionResponse = await authClient.getSession();
      const activeOrganizationId =
        sessionResponse.data?.session.activeOrganizationId ?? null;

      await handleNotificationNavigation(
        target,
        activeOrganizationId,
        router,
        handleSelectWorkspace,
        tDetail,
      );
    })();
  };
}
