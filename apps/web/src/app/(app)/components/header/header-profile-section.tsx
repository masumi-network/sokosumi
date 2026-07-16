import type { Session } from "@sokosumi/utils";
import { Suspense } from "react";
import type { MemberWithOrganization } from "@/lib/clients/generated/core";
import { userService } from "@/lib/services";

import HeaderProfileSectionClient from "./header-profile-section.client";

interface HeaderProfileSectionProps {
  session: Session;
}

function HeaderProfileSectionSkeleton() {
  return (
    <div className="flex items-center gap-2">
      <div className="flex flex-col items-end gap-1">
        <div className="bg-muted h-4 w-28 animate-pulse rounded-md" />
        <div className="bg-muted h-3 w-36 animate-pulse rounded-md" />
      </div>
      <div className="bg-muted size-8 animate-pulse rounded-full" />
    </div>
  );
}

export default function HeaderProfileSection({
  session,
}: HeaderProfileSectionProps) {
  return (
    <Suspense fallback={<HeaderProfileSectionSkeleton />}>
      <HeaderProfileSectionInner session={session} />
    </Suspense>
  );
}

async function HeaderProfileSectionInner({
  session,
}: HeaderProfileSectionProps) {
  const activeOrganizationId = session.session.activeOrganizationId ?? null;

  let members: MemberWithOrganization[] = [];

  try {
    members = await userService.getMyMembersWithOrganizations();
  } catch (_error) {
    members = [];
  }

  return (
    <HeaderProfileSectionClient
      sessionUser={session.user}
      members={members}
      activeOrganizationId={activeOrganizationId}
    />
  );
}
