import gravatarUrl from "gravatar-url";
import { redirect } from "next/navigation";

import { ChatErrorFallback } from "@/app/chat/components/chat-error-fallback";
import { ChatLayoutClient } from "@/app/new-chat-ui/components/chat-layout-client";
import { NEW_CHAT_APP_ROUTE_PREFIX } from "@/app/new-chat-ui/utils/chat-route-base";
import DefaultErrorBoundary from "@/components/default-error-boundary";
import { getSession } from "@/lib/auth/utils";
import { newChatExperimentalEnabled } from "@/lib/flags/new-chat-experimental";
import { userService } from "@/lib/services";

/**
 * When the virtual keyboard opens on mobile, the layout viewport resizes so
 * the chat input stays above the keyboard.
 */
export const viewport = {
  interactiveWidget: "resizes-content" as const,
};

export default async function NewChatLayout({
  children: _children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();

  if (!session) {
    return null;
  }

  if (!(await newChatExperimentalEnabled())) {
    redirect("/chat");
  }

  const userImageUrl =
    session.user.image ??
    gravatarUrl(session.user.email ?? "", {
      size: 80,
      default: "404",
    });

  const activeOrganization = await userService.getActiveOrganization();
  const organizationSlug = activeOrganization?.slug ?? null;

  return (
    <DefaultErrorBoundary fallback={<ChatErrorFallback />}>
      <ChatLayoutClient
        chatShellPrefix={NEW_CHAT_APP_ROUTE_PREFIX}
        mobileKeyboardOptimized
        organizationSlug={organizationSlug}
        userImageUrl={userImageUrl}
        userName={session.user.name ?? undefined}
      />
    </DefaultErrorBoundary>
  );
}
