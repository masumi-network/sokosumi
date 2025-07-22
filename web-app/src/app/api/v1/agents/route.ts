import { NextRequest, NextResponse } from "next/server";

import { createApiRoute } from "@/lib/api/v1/middleware";
import {
  createPaginatedResponse,
  extractPaginationParams,
  requireAuth,
} from "@/lib/api/v1/utils";
import { prisma } from "@/lib/db/repositories";
import { getAvailableAgents } from "@/lib/services/agent";

async function getAgents(request: NextRequest): Promise<NextResponse> {
  await requireAuth();

  const paginationParams = extractPaginationParams(request);

  // Get all available agents (already filtered by access control)
  const agents = await getAvailableAgents(prisma);

  // Apply pagination
  const total = agents.length;
  const startIndex = (paginationParams.page! - 1) * paginationParams.limit!;
  const endIndex = startIndex + paginationParams.limit!;
  const paginatedAgents = agents.slice(startIndex, endIndex);

  return NextResponse.json(
    createPaginatedResponse(paginatedAgents, {
      page: paginationParams.page!,
      limit: paginationParams.limit!,
      total,
    }),
  );
}

export const GET = createApiRoute(getAgents);
