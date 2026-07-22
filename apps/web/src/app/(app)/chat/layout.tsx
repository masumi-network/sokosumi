import gravatarUrl from "gravatar-url";
import { ChatLayoutClient } from "@/app/chat-ui/components/chat-layout-client";
import DefaultErrorBoundary from "@/components/default-error-boundary";
import { getSession } from "@/lib/auth/auth.server";
import { userService } from "@/lib/services";

import { ChatErrorFallback } from "./components/chat-error-fallback";

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

  // Session is request-cached with the app layout; org is request-cached too.
  // Do not await design.md here — chat UI does not use it, and it blocked LCP.
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
