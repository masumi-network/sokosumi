import { InvitationCardSkeleton } from "./components/invitation-card";

export default function AcceptInvitationLoading() {
  return (
    <div className="container flex items-center justify-center px-8 py-12">
      <InvitationCardSkeleton />
    </div>
  );
}
