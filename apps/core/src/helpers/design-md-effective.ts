import type { Prisma } from "@sokosumi/database";
import {
  memberRepository,
  userRepository,
} from "@sokosumi/database/repositories";
import { DESIGN_MD_ATTACHMENT_LABEL } from "@sokosumi/utils";

import {
  readOrganizationDesignMd,
  readUserDesignMd,
} from "@/helpers/design-md";
import prisma from "@/lib/db/prisma";
import type { EffectiveDesignMd } from "@/schemas/design-md.schema";

export interface ResolveEffectiveDesignMdInput {
  userId: string;
  organizationId: string | null;
  tx?: Prisma.TransactionClient;
}

export async function resolveEffectiveDesignMd({
  userId,
  organizationId,
  tx = prisma,
}: ResolveEffectiveDesignMdInput): Promise<EffectiveDesignMd["designMd"]> {
  if (organizationId) {
    const member = await memberRepository.getMemberByUserIdAndOrganizationId(
      userId,
      organizationId,
      tx,
    );

    if (member) {
      const organization = await tx.organization.findUnique({
        where: { id: organizationId },
        select: { metadata: true, name: true, logo: true },
      });
      const organizationDesignMd = readOrganizationDesignMd(
        organization?.metadata,
      );

      if (organizationDesignMd && organization) {
        return {
          label: DESIGN_MD_ATTACHMENT_LABEL,
          url: organizationDesignMd.url,
          owner: {
            type: "organization",
            name: organization.name,
            logo: organization.logo,
          },
        };
      }
    }
  }

  const user = await userRepository.getUserById(userId, tx);
  const userDesignMd = readUserDesignMd(user?.metadata);

  return userDesignMd
    ? {
        label: DESIGN_MD_ATTACHMENT_LABEL,
        url: userDesignMd.url,
        owner: { type: "user" },
      }
    : null;
}
