import { getSession } from "@/lib/auth/auth.server";
import { organizationService } from "@/lib/services";

import InvitationCard, {
  InvitationErrorCard,
} from "./components/invitation-card";

export default async function AcceptInvitationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  // Start session before awaiting params so anonymous cookie short-circuit and
  // logged-in Core session read run in parallel with invitation resolution.
  const sessionPromise = getSession();
  const { id } = await params;
  const [session, result] = await Promise.all([
    sessionPromise,
    organizationService.getPendingInvitation(id),
  ]);

  if (result.error) {
    return <InvitationErrorCard errorCode={result.error} />;
  }

  return (
    <div className="container flex items-center justify-center px-8 py-12">
      <InvitationCard invitation={result.invitation} user={session?.user} />
    </div>
  );
}
