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
import { cn } from "@/lib/utils";
import { isWorkspaceReady } from "@/lib/workspace-gate";
import {
  isJoinLinkDuplicateOfInvitation,
  pendingInvitesDescriptionKey,
  resolveWorkspaceGateSurface,
  type WorkspaceGateQueueItem,
  type WorkspaceGateSurface,
} from "@/lib/workspace-gate-queue";

import { IdentityOnboardingForm } from "./components/identity-onboarding-form.client";
import { PendingInvitesQueue } from "./components/pending-invites-queue.client";
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

  // Org create flips the gate to ready while the wizard is still open.
  // Stay on this page and keep the identity form mounted so client state
  // survives the server-action refresh. The form leaves when the wizard
  // is not open.
  const workspaceReady = !workspaceAccessLoadFailed && isWorkspaceReady(gate);

  const queue =
    workspaceAccessLoadFailed || workspaceReady
      ? { items: [] as WorkspaceGateQueueItem[], invitationsLoadFailed: false }
      : await loadWorkspaceGateQueueItems();
  const queueItems = queue.items;
  const invitationCount = queueItems.filter(
    (item) => item.kind === "invitation",
  ).length;
  const hasJoinLink = queueItems.some((item) => item.kind === "join");

  const surface: WorkspaceGateSurface = workspaceReady
    ? "identity-onboarding"
    : resolveWorkspaceGateSurface({
        workspaceAccessLoadFailed,
        gate,
        invitationCount,
        invitationsLoadFailed: queue.invitationsLoadFailed,
        hasJoinLink,
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
        ? pendingInvitesDescriptionKey({ invitationCount, hasJoinLink })
        : hasName
          ? "identityDescriptionConfirm"
          : "identityDescriptionEnter";
  const showIdentityForm = surface === "identity-onboarding";
  const showPendingQueue = surface === "pending-invites";

  return (
    <Card
      className={cn(
        "w-full",
        workspaceReady && "border-0 bg-transparent py-0 shadow-none",
      )}
      data-workspace-gate-page
      data-gate={surface}
    >
      {workspaceReady ? null : (
        <CardHeader>
          <CardTitle>{t(titleKey)}</CardTitle>
          <CardDescription>{t(descriptionKey)}</CardDescription>
        </CardHeader>
      )}
      <CardContent className={cn("space-y-4", workspaceReady && "px-0")}>
        {showIdentityForm ? (
          <IdentityOnboardingForm
            key="identity-onboarding"
            initialName={session.user.name?.trim() ?? ""}
            workspaceReady={workspaceReady}
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
          <WorkspaceGateSignOut userId={session.user.id} />
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
