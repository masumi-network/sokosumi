import { NextRequest, NextResponse } from "next/server";

import { OrganizationErrorCode, shareJob } from "@/lib/actions";
import {
  createApiSuccessResponse,
  handleApiError,
  jobShareRequestSchema,
  validateApiKey,
} from "@/lib/api";
import { formatJobShareResponse } from "@/lib/api/formatters/job-share";
import { jobRepository } from "@/lib/db/repositories";
import { ShareAccessType } from "@/prisma/generated/client";

interface RouteParams {
  params: Promise<{
    jobId: string;
  }>;
}

/**
 * Share a Job
 * @description Share a Job by `jobId` in params
 * @pathParams JobParams
 * @response JobSuccessResponse
 * @responseSet public
 * @tag Jobs
 * @auth apikey
 * @openapi
 */
export async function POST(
  request: NextRequest,
  { params }: RouteParams,
): Promise<NextResponse> {
  try {
    const apiKey = await validateApiKey(request.headers);
    const { jobId } = await params;

    if (!jobId) {
      throw new Error("INVALID_INPUT");
    }

    const userId = apiKey.userId;
    const activeOrganizationId = apiKey.metadata?.organizationId ?? null;

    // Parse request body
    const body = await request.json();
    const validatedData = jobShareRequestSchema.parse(body);

    // Get the job with authorization check
    const job = await jobRepository.getJobByIdWithAuthCheck(
      jobId,
      apiKey.userId,
      activeOrganizationId,
    );

    if (!job) {
      throw new Error("JOB_NOT_FOUND");
    }

    const recipientOrganizationId = validatedData.shareWithOrganization
      ? activeOrganizationId
      : null;
    const result = await shareJob({
      jobId: job.id,
      recipientOrganizationId,
      shareAccessType: validatedData.accessType ?? ShareAccessType.PUBLIC,
      authContext: { userId, organizationId: activeOrganizationId },
    });
    if (!result.ok) {
      switch (result.error.code) {
        case OrganizationErrorCode.ORGANIZATION_NOT_FOUND:
          throw new Error("ORGANIZATION_NOT_FOUND");
        case OrganizationErrorCode.NOT_ORGANIZATION_MEMBER:
          throw new Error("UNAUTHORIZED");
        default:
          throw new Error(result.error.message ?? "Unknown error");
      }
    }

    // Format and return the job share
    return createApiSuccessResponse(formatJobShareResponse(result.data));
  } catch (error) {
    return handleApiError(error, "retrieve job", {
      path: request.nextUrl.pathname,
    });
  }
}
