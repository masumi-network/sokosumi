import { NextRequest, NextResponse } from "next/server";

import { createApiRoute } from "@/lib/api/v1/middleware";
import { API_ERROR_CODES } from "@/lib/api/v1/types";
import {
  ApiErrorClass,
  createPaginatedResponse,
  extractPaginationParams,
  requireAuth,
  RouteContext,
} from "@/lib/api/v1/utils";
import { getOrganizationMembersWithUser } from "@/lib/services/organization";

async function getOrganizationMembers(
  request: NextRequest,
  context: RouteContext<{ id: string }>,
): Promise<NextResponse> {
  await requireAuth();

  const { id: organizationId } = await context.params;
  if (!organizationId) {
    throw new ApiErrorClass(
      API_ERROR_CODES.BAD_REQUEST,
      "Organization ID is required",
      400,
    );
  }

  const paginationParams = extractPaginationParams(request);

  try {
    const members = await getOrganizationMembersWithUser(
      organizationId,
      true, // Include current user
      {
        page: paginationParams.page!,
        limit: paginationParams.limit!,
      },
    );

    // Note: The getOrganizationMembersWithUser function doesn't return total count
    // For now, we'll use the returned length as the total (this is a limitation)
    return NextResponse.json(
      createPaginatedResponse(members, {
        page: paginationParams.page!,
        limit: paginationParams.limit!,
        total: members.length,
      }),
    );
  } catch (error) {
    if (error instanceof Error && error.message === "NOT_AUTHORIZED") {
      throw new ApiErrorClass(
        API_ERROR_CODES.FORBIDDEN,
        "Access denied to this organization",
        403,
      );
    }
    throw error;
  }
}

export const GET = createApiRoute(getOrganizationMembers);
