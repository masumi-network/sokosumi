import { getSession } from "@/lib/auth/auth.server";
import { coreClient } from "@/lib/clients/core.client";
import { setPendingOrganizationJoinToken } from "@/lib/pending-organization-join-cookie";

import { JoinCard, JoinInvalidCard } from "./components/join-card";

export default async function JoinPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  // Kick off the session read before awaiting params so an anonymous
  // short-circuit and the public link resolution run in parallel.
  const sessionPromise = getSession();
  const { token } = await params;

  let status: "valid" | "expired" | "revoked" | "depleted" | "not_found" =
    "not_found";
  let organization: { name: string; slug: string; logo: string | null } | null =
    null;

  try {
    const resolved = await coreClient.resolveOrganizationInviteLink(token);
    status = resolved.data.status;
    organization = resolved.data.organization;
  } catch (error) {
    console.error("Failed to resolve invite link", error);
  }

  const session = await sessionPromise;

  if (status !== "valid" || !organization) {
    return <JoinInvalidCard status={status} />;
  }

  await setPendingOrganizationJoinToken(token);

  return (
    <JoinCard token={token} organization={organization} user={session?.user} />
  );
}
