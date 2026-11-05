import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { getTranslations } from "next-intl/server";
import { CoreUnavailableNotice } from "@/app/components/core-unavailable-notice.client";
import { ClientMessageBoundary } from "@/i18n/client-message-boundary";
import { SETUP_ASSISTANT_MESSAGE_PATHS } from "@/i18n/message-namespaces";
import { signInRedirectPath } from "@/lib/auth/auth.server";
import { sanitizeAuthRedirectPath } from "@/lib/auth/auth.utils";
import { readRouteSession } from "@/lib/auth/route-session";
import { chatRoomService } from "@/lib/services/chat-room.service";
import { sokoBotService } from "@/lib/services/soko-bot.service";
import { connectOffers } from "@/lib/soko-bot/connect-prompt";
import { sokoBotConsoleRoute } from "@/lib/soko-bot/constants";
import { setupAssistantConnectPath } from "@/lib/workspace-gate";

import { loadWorkspaceGateSearchParams } from "../../search-params";
import { AssistantConnectStep } from "./components/assistant-connect-step.client";

export const instant = false;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("WorkspaceGate.Assistant");
  return { title: t("metadataTitle") };
}

interface SetupAssistantConnectPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * After the bot is created: offer mail and calendar, then its chat. OAuth
 * returns here, so each connected provider shows as done.
 */
export default async function SetupAssistantConnectPage({
  searchParams,
}: SetupAssistantConnectPageProps) {
  // Every read below is per request; say so before the first Core call.
  await connection();
  const sessionRead = await readRouteSession();
  if (sessionRead.status === "unavailable") {
    return <CoreUnavailableNotice />;
  }
  if (sessionRead.status === "signedOut") {
    redirect(await signInRedirectPath());
  }
  const { next } = await loadWorkspaceGateSearchParams(searchParams);
  const returnUrl = sanitizeAuthRedirectPath(next ?? undefined);

  const bot = await sokoBotService.getMine().catch(() => null);
  if (!bot) {
    redirect(returnUrl);
  }
  const [chatUrl, offers] = await Promise.all([
    loadChatUrl(bot.id),
    loadOffers(),
  ]);
  if (offers.length === 0) {
    redirect(chatUrl);
  }

  return (
    <ClientMessageBoundary paths={SETUP_ASSISTANT_MESSAGE_PATHS}>
      <AssistantConnectStep
        botName={bot.name ?? "Soko Bot"}
        offers={offers}
        chatUrl={chatUrl}
        returnTo={setupAssistantConnectPath(returnUrl)}
      />
    </ClientMessageBoundary>
  );
}

/** The bot's direct room; the create form already opened it, so this finds it. */
async function loadChatUrl(sokoBotId: string): Promise<string> {
  try {
    const { room } = await chatRoomService.createRoom({
      kind: "direct",
      memberUserIds: [],
      coworkerIds: [],
      sokoBotIds: [sokoBotId],
    });
    return `/chat/rooms/${encodeURIComponent(room.id)}`;
  } catch (error) {
    console.error("Could not open the new Soko Bot's room", error);
    return sokoBotConsoleRoute(null);
  }
}

/** Empty when mail and calendar are covered or integrations are off. */
async function loadOffers() {
  try {
    const { configured, integrations } =
      await sokoBotService.listIntegrations();
    return configured ? connectOffers(integrations) : [];
  } catch (error) {
    console.error("Skipping the setup connect step", error);
    return [];
  }
}
