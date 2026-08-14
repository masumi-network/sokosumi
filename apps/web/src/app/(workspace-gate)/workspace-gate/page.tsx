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

import { IdentityOnboardingForm } from "./components/identity-onboarding-form.client";
import { WorkspaceGateRetry } from "./components/workspace-gate-retry.client";
import { WorkspaceGateSignOut } from "./components/workspace-gate-sign-out.client";

type GateSurface = "pending-invites" | "identity-onboarding" | "unavailable";

export default async function WorkspaceGatePage() {
  const session = await getSessionOrRedirect();

  let gate: string | null = null;
  let inventoryLoadFailed = false;

  try {
    const inventory = await userService.getWorkspaceInventory();
    if (!inventory) {
      // Session exists but inventory missing — treat as temporary failure,
      // not identity onboarding (user must understand why they cannot enter).
      inventoryLoadFailed = true;
    } else {
      gate = inventory.gate;
    }
  } catch (error) {
    console.error("Failed to load workspace inventory for gate page", error);
    inventoryLoadFailed = true;
  }

  // Ready users never land on the gate.
  if (!inventoryLoadFailed && isWorkspaceReady(gate)) {
    redirect("/");
  }

  const surface: GateSurface = inventoryLoadFailed
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
  const showIdentityForm = surface === "identity-onboarding";

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
