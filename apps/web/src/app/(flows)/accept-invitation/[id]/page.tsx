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

  const session = await getSession();

  const result = await organizationService.getPendingInvitation(id);

  if (result.error) {
    return <InvitationErrorCard errorCode={result.error} />;
  }

  return (
    <div className="container flex items-center justify-center px-8 py-12">
      <InvitationCard invitation={result.invitation} user={session?.user} />
    </div>
  );
}
