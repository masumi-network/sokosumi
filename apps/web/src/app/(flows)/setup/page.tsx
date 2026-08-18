import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getSessionOrRedirect } from "@/lib/auth/auth.server";
import { coreClient } from "@/lib/clients/core.client";
import { getPendingOrganizationJoinToken } from "@/lib/pending-organization-join-cookie";
import { organizationService, userService } from "@/lib/services";
import { isWorkspaceReady } from "@/lib/workspace-gate";
import {
  isJoinLinkDuplicateOfInvitation,
  resolveWorkspaceGateSurface,
  type WorkspaceGateSurface,
} from "@/lib/workspace-gate-queue";

import { IdentityOnboardingForm } from "./components/identity-onboarding-form.client";
import {
  PendingInvitesQueue,
  type WorkspaceGateQueueItem,
} from "./components/pending-invites-queue.client";
import { WorkspaceGateRetry } from "./components/workspace-gate-retry.client";
import { WorkspaceGateSignOut } from "./components/workspace-gate-sign-out.client";

export default async function WorkspaceGatePage() {
  const session = await getSessionOrRedirect();

  let gate: string | null = null;
  let workspaceAccessLoadFailed = false;

  try {
    const workspaceAccess = await userService.getWorkspaceAccess();
    if (!workspaceAccess) {
      // Session exists but workspace-access payload missing — treat as
      // temporary failure, not identity onboarding (user must understand why
      // they cannot enter).
      workspaceAccessLoadFailed = true;
    } else {
      gate = workspaceAccess.gate;
    }
  } catch (error) {
    console.error("Failed to load workspace access for gate page", error);
    workspaceAccessLoadFailed = true;
  }

  if (!workspaceAccessLoadFailed && isWorkspaceReady(gate)) {
    redirect("/");
  }

  const queue = workspaceAccessLoadFailed
    ? { items: [] as WorkspaceGateQueueItem[], invitationsLoadFailed: false }
    : await loadWorkspaceGateQueueItems();
  const queueItems = queue.items;

  const surface: WorkspaceGateSurface = resolveWorkspaceGateSurface({
    workspaceAccessLoadFailed,
    gate,
    invitationCount: queueItems.filter((item) => item.kind === "invitation")
      .length,
    invitationsLoadFailed: queue.invitationsLoadFailed,
    hasJoinLink: queueItems.some((item) => item.kind === "join"),
  });

  const t = await getTranslations("WorkspaceGate");

  const titleKey =
    surface === "unavailable"
      ? "unavailableTitle"
      : surface === "pending-invites"
        ? "pendingInvitesTitle"
        : "identityTitle";
  const hasName = Boolean(session.user.name?.trim());
  const descriptionKey =
    surface === "unavailable"
      ? "unavailableDescription"
      : surface === "pending-invites"
        ? "pendingInvitesDescription"
        : hasName
          ? "identityDescriptionConfirm"
          : "identityDescriptionEnter";
  const showIdentityForm = surface === "identity-onboarding";
  const showPendingQueue = surface === "pending-invites";

  return (
    <Card className="w-full" data-workspace-gate-page data-gate={surface}>
      <CardHeader>
        <CardTitle>{t(titleKey)}</CardTitle>
        <CardDescription>{t(descriptionKey)}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {showIdentityForm ? (
          <IdentityOnboardingForm
            initialName={session.user.name?.trim() ?? ""}
          />
        ) : showPendingQueue ? (
          <PendingInvitesQueue
            items={queueItems}
            initialName={session.user.name?.trim() ?? ""}
          />
        ) : (
          <p className="text-muted-foreground text-sm">
            {t("unavailableBody")}
          </p>
        )}
      </CardContent>
      {surface === "unavailable" ? (
        <CardFooter
          className="flex flex-wrap justify-end gap-2"
          data-workspace-gate-actions
        >
          <WorkspaceGateRetry />
          <WorkspaceGateSignOut />
        </CardFooter>
      ) : null}
    </Card>
  );
}

async function loadWorkspaceGateQueueItems(): Promise<{
  items: WorkspaceGateQueueItem[];
  invitationsLoadFailed: boolean;
}> {
  const items: WorkspaceGateQueueItem[] = [];
  let invitationsLoadFailed = false;

  try {
    const invitations =
      await organizationService.getMyPendingOrganizationInvitations();
    for (const invitation of invitations) {
      items.push({
        kind: "invitation",
        id: invitation.id,
        organizationId: invitation.organizationId,
        organizationName: invitation.organization.name,
        organizationSlug: invitation.organization.slug,
      });
    }
  } catch (error) {
    console.error("Failed to load pending organization invitations", error);
    invitationsLoadFailed = true;
  }

  const joinToken = await getPendingOrganizationJoinToken();
  if (!joinToken) {
    return { items, invitationsLoadFailed };
  }

  try {
    const resolved = await coreClient.resolveOrganizationInviteLink(joinToken);
    if (resolved.data.status === "valid" && resolved.data.organization) {
      const joinSlug = resolved.data.organization.slug;
      if (
        !isJoinLinkDuplicateOfInvitation(
          items
            .filter((item) => item.kind === "invitation")
            .map((item) => item.organizationSlug),
          joinSlug,
        )
      ) {
        items.push({
          kind: "join",
          token: joinToken,
          organizationName: resolved.data.organization.name,
          organizationSlug: joinSlug,
        });
      }
    }
  } catch (error) {
    console.error("Failed to resolve pending organization join token", error);
  }

  return { items, invitationsLoadFailed };
}
