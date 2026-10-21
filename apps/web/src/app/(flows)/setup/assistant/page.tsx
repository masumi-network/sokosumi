import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { CoreUnavailableNotice } from "@/app/components/core-unavailable-notice.client";
import { ClientMessageBoundary } from "@/i18n/client-message-boundary";
import { SETUP_ASSISTANT_MESSAGE_PATHS } from "@/i18n/message-namespaces";
import { signInRedirectPath } from "@/lib/auth/auth.server";
import { sanitizeAuthRedirectPath } from "@/lib/auth/auth.utils";
import { readRouteSession } from "@/lib/auth/route-session";
import { organizationSeatService } from "@/lib/services/organization-seat.service";
import { sokoBotService } from "@/lib/services/soko-bot.service";
import { userService } from "@/lib/services/user.service";
import {
  isWorkspaceReady,
  setupAssistantConnectPath,
} from "@/lib/workspace-gate";

import { loadWorkspaceGateSearchParams } from "../search-params";
import { AssistantCreateStep } from "./components/assistant-create-step.client";

export const instant = false;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("WorkspaceGate.Assistant");
  return { title: t("metadataTitle") };
}

interface SetupAssistantPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * Setup's last step: offers the personal Soko Bot to someone who just got a
 * workspace. Anyone it does not apply to goes straight on to `next`.
 */
export default async function SetupAssistantPage({
  searchParams,
}: SetupAssistantPageProps) {
  const sessionRead = await readRouteSession();
  if (sessionRead.status === "unavailable") {
    return <CoreUnavailableNotice />;
  }
  if (sessionRead.status === "signedOut") {
    redirect(await signInRedirectPath());
  }
  const { session } = sessionRead;
  const { next } = await loadWorkspaceGateSearchParams(searchParams);
  const returnUrl = sanitizeAuthRedirectPath(next ?? undefined);
  const organizationId = session.session.activeOrganizationId ?? null;

  const step = await resolveAssistantStep(organizationId);
  if (step === "skip") {
    redirect(returnUrl);
  }
  // Creating the bot refreshes this page, so a bot here means the create
  // step just finished: carry on to the optional connect step.
  if (step === "connect") {
    redirect(setupAssistantConnectPath(returnUrl));
  }

  return (
    <ClientMessageBoundary paths={SETUP_ASSISTANT_MESSAGE_PATHS}>
      <AssistantCreateStep
        paidByOrganization={organizationId !== null}
        laterUrl={returnUrl}
        connectUrl={setupAssistantConnectPath(returnUrl)}
      />
    </ClientMessageBoundary>
  );
}

/**
 * `create` only for a workspace-ready user, with product access, who has no
 * Soko Bot yet. Any failed read skips the step: it must never block entry.
 */
async function resolveAssistantStep(
  organizationId: string | null,
): Promise<"create" | "connect" | "skip"> {
  try {
    const access = await userService.getWorkspaceAccess();
    if (!isWorkspaceReady(access?.gate)) {
      return "skip";
    }
    if (
      organizationId !== null &&
      !(await organizationSeatService.hasAssignedSeat(organizationId))
    ) {
      return "skip";
    }
    return (await sokoBotService.getMine()) === null ? "create" : "connect";
  } catch (error) {
    console.error("Skipping the setup assistant step", error);
    return "skip";
  }
}
