import { MemberWithOrganization } from "@sokosumi/database";
import { Suspense } from "react";

import { Session } from "@/lib/auth/auth";
import { userService } from "@/lib/services";

import ProfileSwitchClient from "./profile-switch.client";

interface ProfileSwitchProps {
  session: Session;
}

function ProfileSwitchSkeleton() {
  return (
    <div className="px-4 py-2.5">
      <div className="bg-muted h-10 w-full animate-pulse rounded-md" />
    </div>
  );
}

export default function ProfileSwitch({ session }: ProfileSwitchProps) {
  return (
    <Suspense fallback={<ProfileSwitchSkeleton />}>
      <ProfileSwitchInner session={session} />
    </Suspense>
  );
}

async function ProfileSwitchInner({ session }: ProfileSwitchProps) {
  let members: MemberWithOrganization[] = [];

  try {
    members = await userService.getMyMembersWithOrganizations();
  } catch (_error) {
    members = [];
  }

  return (
    <ProfileSwitchClient
      sessionUser={session.user}
      members={members}
      activeOrganizationId={session.session.activeOrganizationId ?? null}
    />
  );
}
