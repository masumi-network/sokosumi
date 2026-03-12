import "server-only";

import {
  memberRepository,
  userRepository,
} from "@sokosumi/database/repositories";

import prisma from "@/lib/db/prisma";

interface PersistPreferredOrganizationResult {
  ok: boolean;
  organizationId: string | null;
}

export const preferredOrganizationService = (() => {
  async function resolveActiveOrganizationIdForSession(
    userId: string,
  ): Promise<string | null> {
    const user = await userRepository.getUserById(userId, prisma);
    const preferredOrganizationId = user?.preferredOrganizationId ?? null;

    if (!preferredOrganizationId) {
      return null;
    }

    const member = await memberRepository.getMemberByUserIdAndOrganizationId(
      userId,
      preferredOrganizationId,
      prisma,
    );

    return member ? preferredOrganizationId : null;
  }

  async function persistPreferredOrganizationId(
    userId: string,
    organizationId: string | null,
  ): Promise<PersistPreferredOrganizationResult> {
    if (!organizationId) {
      await userRepository.updatePreferredOrganizationId(userId, null, prisma);
      return {
        ok: true,
        organizationId: null,
      };
    }

    const member = await memberRepository.getMemberByUserIdAndOrganizationId(
      userId,
      organizationId,
      prisma,
    );

    if (!member) {
      return {
        ok: false,
        organizationId: null,
      };
    }

    await userRepository.updatePreferredOrganizationId(
      userId,
      organizationId,
      prisma,
    );

    return {
      ok: true,
      organizationId,
    };
  }

  return {
    resolveActiveOrganizationIdForSession,
    persistPreferredOrganizationId,
  };
})();
