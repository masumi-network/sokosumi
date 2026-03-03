import gravatarUrl from "gravatar-url";

import { ChatErrorFallback } from "@/app/chat/components/chat-error-fallback";
import { ChatLayoutClient } from "@/app/chat/components/chat-layout-client";
import DefaultErrorBoundary from "@/components/default-error-boundary";
import { getSession } from "@/lib/auth/utils";
import { userService } from "@/lib/services";

/**
 * Viewport: when the virtual keyboard opens on mobile, the layout viewport
 * resizes so the chat input stays above the keyboard (only on /chat_test).
 */
export const viewport = {
  interactiveWidget: "resizes-content" as const,
};

export default async function ChatTestLayout({
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
        routeBase="chat_test"
        userImageUrl={userImageUrl}
        userName={session.user.name ?? undefined}
      />
    </DefaultErrorBoundary>
  );
}
