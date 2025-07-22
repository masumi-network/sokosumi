import { NextRequest, NextResponse } from "next/server";

import { createApiRoute } from "@/lib/api/v1/middleware";
import {
  createPaginatedResponse,
  extractPaginationParams,
  requireAuth,
} from "@/lib/api/v1/utils";
import { getActiveOrganizationId } from "@/lib/auth/utils";
import { prisma } from "@/lib/db/repositories";

async function getCreditTransactions(
  request: NextRequest,
): Promise<NextResponse> {
  const session = await requireAuth();
  const activeOrganizationId = await getActiveOrganizationId();
  const paginationParams = extractPaginationParams(request);

  // Build query conditions
  const whereConditions: Record<string, unknown> = {
    userId: session.user.id,
  };

  if (activeOrganizationId) {
    whereConditions.organizationId = activeOrganizationId;
  } else {
    whereConditions.organizationId = null;
  }

  // Get total count
  const total = await prisma.creditTransaction.count({
    where: whereConditions,
  });

  // Get paginated transactions
  const transactions = await prisma.creditTransaction.findMany({
    where: whereConditions,
    orderBy: {
      createdAt: "desc",
    },
    skip: (paginationParams.page! - 1) * paginationParams.limit!,
    take: paginationParams.limit!,
  });

  return NextResponse.json(
    createPaginatedResponse(transactions, {
      page: paginationParams.page!,
      limit: paginationParams.limit!,
      total,
    }),
  );
}

export const GET = createApiRoute(getCreditTransactions);
