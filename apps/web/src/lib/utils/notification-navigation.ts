import { getNotificationHref } from "@sokosumi/utils";
import type { AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { coreClient } from "@/lib/clients/core.browser.client";
import type { NotificationItem } from "@/lib/clients/generated/core";
import { getWorkspaceOrganizationId } from "@/lib/services/workspace.service";
import { resolveAccountName } from "@/lib/utils/account-name";

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

async function getMembersForAccountName() {
  return await coreClient.getMyMembersWithOrganizations();
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

  if (!href) {
    console.warn("Notification has no navigation target", {
      kind: notification.kind,
      referenceId: notification.referenceId,
    });
    return;
  }

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

  // Resolve workspace org first; only load members when a switch is required.
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

  let successMessage: string | undefined;
  try {
    const membersResponse = await getMembersForAccountName();
    const accountName = resolveAccountName(
      organizationId,
      membersResponse.data,
      t("personalWorkspace"),
    );
    successMessage = t("switchedWorkspace", { account: accountName });
  } catch (error) {
    console.warn(
      "Failed to resolve workspace account name for notification switch",
      error,
    );
  }

  try {
    await handleSelectWorkspace(organizationId, {
      shouldRedirectAgentJobsBasePath: false,
      successMessage,
    });
  } catch (error) {
    console.warn("Failed to switch workspace for notification", error);
    return;
  }

  router.push(href);
}
