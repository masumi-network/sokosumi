import { NextRequest, NextResponse } from "next/server";

import { createApiRoute } from "@/lib/api/v1/middleware";
import { createApiResponse, requireAuth } from "@/lib/api/v1/utils";
import { getActiveOrganizationId } from "@/lib/auth/utils";
import { convertCentsToCredits } from "@/lib/db";
import {
  prisma,
  retrieveCentsByOrganizationId,
  retrieveCentsByUserId,
} from "@/lib/db/repositories";

async function getCreditBalance(_request: NextRequest): Promise<NextResponse> {
  const session = await requireAuth();
  const activeOrganizationId = await getActiveOrganizationId();

  let balanceInCents: bigint;

  if (activeOrganizationId) {
    // Get organization balance
    balanceInCents = await retrieveCentsByOrganizationId(
      activeOrganizationId,
      prisma,
    );
  } else {
    // Get user balance
    balanceInCents = await retrieveCentsByUserId(session.user.id, prisma);
  }

  const balanceInCredits = convertCentsToCredits(balanceInCents);

  const response = {
    balance: {
      credits: balanceInCredits,
      cents: balanceInCents,
    },
    organizationId: activeOrganizationId,
  };

  return NextResponse.json(createApiResponse(response));
}

export const GET = createApiRoute(getCreditBalance);
