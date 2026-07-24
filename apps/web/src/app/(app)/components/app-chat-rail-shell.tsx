import type { Session } from "@sokosumi/utils";

import { userService } from "@/lib/services";

import ChatRail from "./chat-rail";

interface AppChatRailShellProps {
  session: Session;
  userImageUrl: string;
}

export default async function AppChatRailShell({
  session,
  userImageUrl,
}: AppChatRailShellProps) {
  const activeOrganization = await userService.getActiveOrganization();

  return (
    <ChatRail
      organizationSlug={activeOrganization?.slug ?? null}
      userImageUrl={userImageUrl}
      userName={session.user.name ?? undefined}
    />
  );
}
