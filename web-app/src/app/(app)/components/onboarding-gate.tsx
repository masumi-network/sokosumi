import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { auth, Session } from "@/lib/auth/auth";
import { invitationRepository, memberRepository } from "@/lib/db/repositories";

interface OnboardingGateProps {
  session: Session;
}

export function OnboardingGate({ session }: OnboardingGateProps) {
  return <OnboardingGateImpl session={session} />;
}

async function OnboardingGateImpl({ session }: OnboardingGateProps) {
  if (session.user.onboardingCompleted) {
    return null;
  }

  const memberships = await memberRepository.getMembersOrganizationIdsByUserId(
    session.user.id,
  );

  let setOnboardingCompleted = false;

  if (memberships.length > 0) {
    setOnboardingCompleted = true;
  } else {
    try {
      const email = session.user.email;
      if (email) {
        const hasPending =
          await invitationRepository.hasPendingInvitationByEmail(email);
        setOnboardingCompleted = hasPending;
      }
    } catch (error) {
      console.error(
        "Failed to fetch pending invitations for onboarding gate",
        error,
      );
    }
  }

  if (setOnboardingCompleted) {
    await auth.api.updateUser({
      headers: await headers(),
      body: { onboardingCompleted: true },
    });
    return null;
  }

  redirect("/onboarding");
}
