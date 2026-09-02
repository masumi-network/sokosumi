import type { Session } from "@sokosumi/utils";
import { Suspense } from "react";
import { getPrivateCachedChatListChrome } from "@/app/components/private-sidebar-cache";
import { userService } from "@/lib/services";
import HeaderProfileSectionClient from "./header-profile-section.client";
import { HeaderTrailingTools } from "./header-trailing-tools";

interface HeaderProfileSectionProps {
  session: Session;
}

function HeaderProfileSectionSkeleton() {
  return (
    <div
      className="hidden h-auto items-center gap-1.5 md:flex"
      aria-hidden
      data-testid="header-desktop-workspace-chrome-skeleton"
    >
      <div className="bg-muted h-3 w-20 animate-pulse rounded-md" />
      <div className="bg-muted size-4 shrink-0 animate-pulse rounded-full" />
    </div>
  );
}

export default function HeaderProfileSection({
  session,
}: HeaderProfileSectionProps) {
  return (
    <div className="flex h-8 items-center gap-1.5 md:h-auto">
      <Suspense fallback={<HeaderProfileSectionSkeleton />}>
        <HeaderProfileSectionInner session={session} />
      </Suspense>
      <HeaderTrailingTools />
    </div>
  );
}

async function HeaderProfileSectionInner({
  session,
}: HeaderProfileSectionProps) {
  const activeOrganizationId = session.session.activeOrganizationId ?? null;

  // Await the shared private-cache chrome slice (rooms + archived + members)
  // so the desktop Workspace switcher uses last-known members. Notification
  // Center + mobile Search stay outside this Suspense.
  const [{ members }, workspaceAccess] = await Promise.all([
    getPrivateCachedChatListChrome({
      userId: session.user.id,
      activeOrganizationId,
    }),
    userService.getWorkspaceAccess(),
  ]);

  return (
    <HeaderProfileSectionClient
      sessionUser={session.user}
      members={members}
      hasPersonalWorkspace={workspaceAccess?.hasPersonalWorkspace ?? false}
      activeOrganizationId={activeOrganizationId}
    />
  );
}
