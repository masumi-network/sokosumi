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
import { userService } from "@/lib/services";
import { isWorkspaceReady } from "@/lib/workspace-gate";

import { WorkspaceGateRetry } from "./components/workspace-gate-retry.client";
import { WorkspaceGateSignOut } from "./components/workspace-gate-sign-out.client";

type GateSurface = "pending-invites" | "identity-onboarding" | "unavailable";

export default async function WorkspaceGatePage() {
  await getSessionOrRedirect();

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

  const surface: GateSurface = workspaceAccessLoadFailed
    ? "unavailable"
    : gate === "pending-invites"
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

  return (
    <Card className="w-full" data-workspace-gate-page data-gate={surface}>
      <CardHeader>
        <CardTitle>{t(titleKey)}</CardTitle>
        <CardDescription>{t(descriptionKey)}</CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-muted-foreground text-sm">{t(bodyKey)}</p>
      </CardContent>
      <CardFooter className="flex flex-wrap justify-end gap-2">
        {surface === "unavailable" ? <WorkspaceGateRetry /> : null}
        <WorkspaceGateSignOut />
      </CardFooter>
    </Card>
  );
}
