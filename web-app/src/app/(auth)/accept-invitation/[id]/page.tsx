import { redirect } from "next/navigation";

import { getSession } from "@/lib/auth/utils";
import { organizationService } from "@/lib/services";

import InvitationCard, {
  InvitationErrorCard,
} from "./components/invitation-card";

export default async function AcceptInvitationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const invitationResult = await organizationService.getPendingInvitation(id);

  if (invitationResult.error) {
    return (
      <div className="container flex items-center justify-center px-8 py-12">
        <InvitationErrorCard errorCode={invitationResult.error} />
      </div>
    );
  }

  const session = await getSession();

  const invitation = invitationResult.invitation;
  const { organization, status } = invitation;

  if (status === "accepted") {
    redirect(`/organizations/${organization.slug}`);
  }

  return (
    <div className="container flex items-center justify-center px-8 py-12">
      <InvitationCard invitation={invitation} user={session?.user} />
    </div>
  );
}
