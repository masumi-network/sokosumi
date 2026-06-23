import type { AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";

import { coreClient } from "@/lib/clients/core.browser.client";
import type { NotificationItem } from "@/lib/clients/generated/core";
import { getWorkspaceOrganizationId } from "@/lib/services/workspace.service";
import { resolveAccountName } from "@/lib/utils/account-name";
import { getNotificationHref } from "@/lib/utils/notification-href";

type HandleSelectWorkspace = (
  organizationId: string | null,
  options?: {
    shouldRedirectAgentJobsBasePath?: boolean;
    successMessage?: string;
  },
) => Promise<void>;

type NotificationNavigationTranslator = (
  key: "switchedWorkspace" | "personalWorkspace",
  values?: { account: string },
) => string;

let membersPromise: ReturnType<
  typeof coreClient.getMyMembersWithOrganizations
> | null = null;

async function getMembersForAccountName() {
  membersPromise ??= coreClient.getMyMembersWithOrganizations();
  return membersPromise;
}

function getWorkspaceIdFromMetadata(
  metadata: Record<string, unknown> | null,
): string | null {
  const workspaceId = metadata?.workspaceId;
  if (typeof workspaceId !== "string" || workspaceId.length === 0) {
    return null;
  }

  return workspaceId;
}

export async function handleNotificationNavigation(
  notification: Pick<NotificationItem, "kind" | "referenceId" | "metadata">,
  activeOrgId: string | null,
  router: AppRouterInstance,
  handleSelectWorkspace: HandleSelectWorkspace,
  t: NotificationNavigationTranslator,
): Promise<void> {
  const href = getNotificationHref({
    kind: notification.kind,
    referenceId: notification.referenceId,
    metadata: notification.metadata,
  });

  const workspaceId = getWorkspaceIdFromMetadata(notification.metadata);
  if (!workspaceId) {
    console.warn(
      "Notification missing workspaceId, navigating without workspace switch",
      {
        kind: notification.kind,
        referenceId: notification.referenceId,
      },
    );
    router.push(href);
    return;
  }

  const organizationId = await getWorkspaceOrganizationId(workspaceId);
  if (organizationId === undefined) {
    console.warn(
      "Failed to resolve workspace organization, navigating without workspace switch",
      { workspaceId },
    );
    router.push(href);
    return;
  }

  if (activeOrgId === organizationId) {
    router.push(href);
    return;
  }

  try {
    const membersResponse = await getMembersForAccountName();
    const accountName = resolveAccountName(
      organizationId,
      membersResponse.data,
      t("personalWorkspace"),
    );

    await handleSelectWorkspace(organizationId, {
      shouldRedirectAgentJobsBasePath: false,
      successMessage: t("switchedWorkspace", { account: accountName }),
    });
  } catch (error) {
    console.warn(
      "Failed to switch workspace for notification, navigating without switch",
      error,
    );
  }

  router.push(href);
}
