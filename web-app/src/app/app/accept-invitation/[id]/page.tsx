import { headers } from "next/headers";

import { auth } from "@/lib/auth/auth";

import InvitationCard from "./components/invitation";

export default async function AcceptInvitationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const invitation = await auth.api.getInvitation({
    headers: await headers(),
    query: { id },
  });

  return (
    <div className="container flex items-center justify-center px-8 py-12">
      <InvitationCard invitation={invitation} />
    </div>
  );
}
