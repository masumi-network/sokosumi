import { userRepository } from "@sokosumi/database/repositories";

import { getSession } from "@/lib/auth/utils";
import {
  organizationService,
  PendingInvitationErrorCode,
} from "@/lib/services";

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

  const { error, invitation } =
    await organizationService.getPendingInvitation(id);

  if (error) {
    return <InvitationErrorCard errorCode={error} />;
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
      <InvitationCard invitation={invitation} user={session?.user} />
    </div>
  );
}
