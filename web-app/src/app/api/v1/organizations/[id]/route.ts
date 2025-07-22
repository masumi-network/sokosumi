import { NextRequest, NextResponse } from "next/server";

import { createApiRoute } from "@/lib/api/v1/middleware";
import { API_ERROR_CODES } from "@/lib/api/v1/types";
import {
  ApiErrorClass,
  createApiResponse,
  requireAuth,
  RouteContext,
} from "@/lib/api/v1/utils";
import { retrieveOrganizationWithRelationsById } from "@/lib/db/repositories";
import { getMyMemberInOrganization } from "@/lib/services/organization";

async function getOrganizationById(
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

  // Check if user is a member of this organization
  const member = await getMyMemberInOrganization(organizationId);
  if (!member) {
    throw new ApiErrorClass(
      API_ERROR_CODES.FORBIDDEN,
      "Access denied to this organization",
      403,
    );
  }

  const organization =
    await retrieveOrganizationWithRelationsById(organizationId);
  if (!organization) {
    throw new ApiErrorClass(
      API_ERROR_CODES.NOT_FOUND,
      "Organization not found",
      404,
    );
  }

  return NextResponse.json(createApiResponse(organization));
}

export const GET = createApiRoute(getOrganizationById);
