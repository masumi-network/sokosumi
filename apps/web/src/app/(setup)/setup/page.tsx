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
import {
  clearPendingOrganizationJoinToken,
  getPendingOrganizationJoinToken,
} from "@/lib/pending-organization-join-cookie";
import { organizationService, userService } from "@/lib/services";
import { isWorkspaceReady } from "@/lib/workspace-gate";
import { shouldShowPendingInvitesQueue } from "@/lib/workspace-gate-queue";

import { IdentityOnboardingForm } from "./components/identity-onboarding-form.client";
import {
  PendingInvitesQueue,
  type WorkspaceGateQueueItem,
} from "./components/pending-invites-queue.client";
import { WorkspaceGateRetry } from "./components/workspace-gate-retry.client";
import { WorkspaceGateSignOut } from "./components/workspace-gate-sign-out.client";

type GateSurface = "pending-invites" | "identity-onboarding" | "unavailable";

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

  // Ready users never land on the gate.
  if (!workspaceAccessLoadFailed && isWorkspaceReady(gate)) {
    redirect("/");
  }

  const queueItems = workspaceAccessLoadFailed
    ? []
    : await loadWorkspaceGateQueueItems();

  const surface: GateSurface = workspaceAccessLoadFailed
    ? "unavailable"
    : shouldShowPendingInvitesQueue({
          gate,
          invitationCount: queueItems.filter(
            (item) => item.kind === "invitation",
          ).length,
          hasJoinLink: queueItems.some((item) => item.kind === "join"),
        })
      ? "pending-invites"
      : "identity-onboarding";

  const t = await getTranslations("WorkspaceGate");

  const titleKey =
    surface === "unavailable"
      ? "unavailableTitle"
      : surface === "pending-invites"
        ? "pendingInvitesTitle"
        : "identityTitle";
  const descriptionKey =
    surface === "unavailable"
      ? "unavailableDescription"
      : surface === "pending-invites"
        ? "pendingInvitesDescription"
        : "identityDescription";
  const bodyKey = surface === "unavailable" ? "unavailableBody" : "body";
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
          <PendingInvitesQueue items={queueItems} />
        ) : (
          <p className="text-muted-foreground text-sm">{t(bodyKey)}</p>
        )}
      </CardContent>
      <CardFooter className="flex flex-wrap justify-end gap-2">
        {surface === "unavailable" ? <WorkspaceGateRetry /> : null}
        <WorkspaceGateSignOut />
      </CardFooter>
    </Card>
  );
}

async function loadWorkspaceGateQueueItems(): Promise<
  WorkspaceGateQueueItem[]
> {
  const items: WorkspaceGateQueueItem[] = [];

  try {
    const invitations =
      await organizationService.getMyPendingOrganizationInvitations();
    for (const invitation of invitations) {
      items.push({
        kind: "invitation",
        id: invitation.id,
        organizationId: invitation.organizationId,
        organizationName: invitation.organization.name,
      });
    }
  } catch (error) {
    console.error("Failed to load pending organization invitations", error);
  }

  const joinToken = await getPendingOrganizationJoinToken();
  if (!joinToken) {
    return items;
  }

  try {
    const resolved = await coreClient.resolveOrganizationInviteLink(joinToken);
    if (resolved.data.status === "valid" && resolved.data.organization) {
      items.push({
        kind: "join",
        token: joinToken,
        organizationName: resolved.data.organization.name,
      });
    } else {
      await clearPendingOrganizationJoinToken();
    }
  } catch (error) {
    console.error("Failed to resolve pending organization join token", error);
    await clearPendingOrganizationJoinToken();
  }

  return items;
}
