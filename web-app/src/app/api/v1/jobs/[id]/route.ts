import { NextRequest, NextResponse } from "next/server";

import { createApiRoute } from "@/lib/api/v1/middleware";
import { API_ERROR_CODES } from "@/lib/api/v1/types";
import {
  ApiErrorClass,
  createApiResponse,
  requireAuth,
} from "@/lib/api/v1/utils";
import { retrieveJobByIdUserIdAndOrganizationId } from "@/lib/db/repositories";

async function getJobById(
  request: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const session = await requireAuth();

  const jobId = params.id;
  if (!jobId) {
    throw new ApiErrorClass(
      API_ERROR_CODES.BAD_REQUEST,
      "Job ID is required",
      400,
    );
  }
  const job = await retrieveJobByIdUserIdAndOrganizationId(
    jobId,
    session.user.id,
    session.session.activeOrganizationId ?? null,
  );

  if (!job) {
    throw new ApiErrorClass(API_ERROR_CODES.NOT_FOUND, "Job not found", 404);
  }

  return NextResponse.json(createApiResponse(job));
}

export const GET = createApiRoute(getJobById);
