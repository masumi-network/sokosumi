import { NextRequest, NextResponse } from "next/server";

import { createApiRoute } from "@/lib/api/v1/middleware";
import {
  createPaginatedResponse,
  extractPaginationParams,
} from "@/lib/api/v1/utils";
import { getAvailableAgents } from "@/lib/services/agent";

async function getAgents(request: NextRequest): Promise<NextResponse> {
  const paginationParams = extractPaginationParams(request);

  const agents = await getAvailableAgents();

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
