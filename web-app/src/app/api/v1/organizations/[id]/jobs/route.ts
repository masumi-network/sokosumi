import { NextRequest, NextResponse } from "next/server";

import { createApiRoute } from "@/lib/api/v1/middleware";
import { API_ERROR_CODES } from "@/lib/api/v1/types";
import {
  ApiErrorClass,
  createPaginatedResponse,
  extractPaginationParams,
  requireAuth,
} from "@/lib/api/v1/utils";
import { retrieveJobsByOrganizationId } from "@/lib/db/repositories";
import { getMyMemberInOrganization } from "@/lib/services/organization";

async function getOrganizationJobs(
  request: NextRequest,
  context: { params: { id: string } },
): Promise<NextResponse> {
  await requireAuth();

  const organizationId = context.params.id;
  if (!organizationId) {
    throw new ApiErrorClass(
      API_ERROR_CODES.BAD_REQUEST,
      "Organization ID is required",
      400,
    );
  }

  // Check if user is a member of this organization
  const member = await getMyMemberInOrganization(organizationId);
  if (!member) {
    throw new ApiErrorClass(
      API_ERROR_CODES.FORBIDDEN,
      "Access denied to this organization",
      403,
    );
  }

  const paginationParams = extractPaginationParams(request);

  const jobs = await retrieveJobsByOrganizationId(organizationId);

  // Apply pagination
  const total = jobs.length;
  const startIndex = (paginationParams.page! - 1) * paginationParams.limit!;
  const endIndex = startIndex + paginationParams.limit!;
  const paginatedJobs = jobs.slice(startIndex, endIndex);

  return NextResponse.json(
    createPaginatedResponse(paginatedJobs, {
      page: paginationParams.page!,
      limit: paginationParams.limit!,
      total,
    }),
  );
}

export const GET = createApiRoute(getOrganizationJobs);
