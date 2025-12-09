import {
  organizationRepository,
  userRepository,
} from "@sokosumi/database/repositories";

import { authClient } from "@/lib/auth/auth.client";
import { getSession } from "@/lib/auth/utils";
import { PendingInvitationErrorCode } from "@/lib/services";

import InvitationCard, {
  InvitationErrorCard,
} from "./components/invitation-card";

export default async function AcceptInvitationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const session = await getSession();

  const { data: invitation } = await authClient.organization.getInvitation({
    query: {
      id,
    },
  });

  if (!invitation) {
    return (
      <div className="container flex items-center justify-center px-8 py-12">
        <InvitationErrorCard errorCode={PendingInvitationErrorCode.NOT_FOUND} />
      </div>
    );
  }

  if (invitation.expiresAt < new Date()) {
    return (
      <div className="container flex items-center justify-center px-8 py-12">
        <InvitationErrorCard errorCode={PendingInvitationErrorCode.EXPIRED} />
      </div>
    );
  }

  const organization =
    await organizationRepository.getOrganizationWithRelationsById(
      invitation.organizationId,
    );

  if (!organization) {
    return (
      <div className="container flex items-center justify-center px-8 py-12">
        <InvitationErrorCard
          errorCode={PendingInvitationErrorCode.ORGANIZATION_NOT_FOUND}
        />
      </div>
    );
  }

  const inviter = await userRepository.getUserById(invitation.inviterId);

  if (!inviter) {
    return (
      <div className="container flex items-center justify-center px-8 py-12">
        <InvitationErrorCard
          errorCode={PendingInvitationErrorCode.INVITER_NOT_FOUND}
        />
      </div>
    );
  }

  return (
    <div className="container flex items-center justify-center px-8 py-12">
      <InvitationCard
        invitation={invitation}
        organization={organization}
        inviter={inviter}
        user={session?.user}
      />
    </div>
  );
}
