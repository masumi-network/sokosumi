import type { Session } from "@sokosumi/utils";
import { Suspense } from "react";
import { userService } from "@/lib/services/user.service";
import HeaderProfileSectionClient from "./header-profile-section.client";
import { HeaderTrailingTools } from "./header-trailing-tools";

interface HeaderProfileSectionProps {
  session: Session;
}

function HeaderProfileSectionSkeleton() {
  return (
    <div
      className="flex h-auto items-center gap-1.5"
      aria-hidden
      data-testid="header-workspace-chrome-skeleton"
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

  // One Core read lists the switcher's workspaces (ADR 0051). Notification
  // Center + mobile Search stay outside this Suspense.
  const workspaces = (await userService.getMyWorkspaces())?.workspaces ?? [];

  return (
    <HeaderProfileSectionClient
      sessionUser={session.user}
      workspaces={workspaces}
      hasPersonalWorkspace={workspaces.some(({ kind }) => kind === "personal")}
      activeOrganizationId={activeOrganizationId}
    />
  );
}
