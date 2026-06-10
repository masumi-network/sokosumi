import {
  memberRepository,
  userRepository,
} from "@sokosumi/database/repositories";
import type { Prisma } from "@sokosumi/database";

export interface OnboardingStatus {
  show: boolean;
  completed: boolean;
}

export async function resolveOnboardingStatus(
  userId: string,
  tx: Prisma.TransactionClient,
): Promise<OnboardingStatus> {
  const user = await userRepository.getUserById(userId, tx);
  if (!user) {
    return { show: false, completed: false };
  }

  if (user.onboardingCompleted) {
    return { show: false, completed: true };
  }

  const membershipOrgIds =
    await memberRepository.getMembersOrganizationIdsByUserId(userId, tx);

  if (membershipOrgIds.length > 0) {
    await userRepository.updateUserOnboardingCompleted(userId, true, tx);
    return { show: false, completed: true };
  }

  return { show: true, completed: false };
}
