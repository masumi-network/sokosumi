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

import { WorkspaceGateSignOut } from "./components/workspace-gate-sign-out.client";

export default async function WorkspaceGatePage() {
  await getSessionOrRedirect();

  let gate: string | null = null;
  try {
    const inventory = await userService.getWorkspaceInventory();
    gate = inventory?.gate ?? null;
  } catch (error) {
    console.error("Failed to load workspace inventory for gate page", error);
  }

  // Ready users never land on the gate.
  if (isWorkspaceReady(gate)) {
    redirect("/");
  }

  const t = await getTranslations("WorkspaceGate");
  const titleKey =
    gate === "pending-invites" ? "pendingInvitesTitle" : "identityTitle";
  const descriptionKey =
    gate === "pending-invites"
      ? "pendingInvitesDescription"
      : "identityDescription";

  return (
    <Card
      className="w-full"
      data-workspace-gate-page
      data-gate={gate ?? "unknown"}
    >
      <CardHeader>
        <CardTitle>{t(titleKey)}</CardTitle>
        <CardDescription>{t(descriptionKey)}</CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-muted-foreground text-sm">{t("body")}</p>
      </CardContent>
      <CardFooter className="justify-end">
        <WorkspaceGateSignOut />
      </CardFooter>
    </Card>
  );
}
