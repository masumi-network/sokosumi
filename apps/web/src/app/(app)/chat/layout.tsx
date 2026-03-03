import gravatarUrl from "gravatar-url";

import DefaultErrorBoundary from "@/components/default-error-boundary";
import { getSession } from "@/lib/auth/utils";
import { userService } from "@/lib/services";

import { ChatErrorFallback } from "./components/chat-error-fallback";
import { ChatLayoutClient } from "./components/chat-layout-client";

/**
 * When the virtual keyboard opens on mobile, the layout viewport resizes so
 * the chat input stays above the keyboard.
 */
export const viewport = {
  interactiveWidget: "resizes-content" as const,
};

export default async function ChatLayout({
  children: _children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();

  if (!session) {
    return null;
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
        mobileKeyboardOptimized
        organizationSlug={organizationSlug}
        userImageUrl={userImageUrl}
        userName={session.user.name ?? undefined}
      />
    </DefaultErrorBoundary>
  );
}
