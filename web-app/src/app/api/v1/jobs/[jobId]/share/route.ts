import { NextRequest, NextResponse } from "next/server";

import {
  ActionError,
  JobErrorCode,
  OrganizationErrorCode,
  removeJobShares,
  removeSharesPerJob,
  shareJob,
} from "@/lib/actions";
import {
  createApiSuccessResponse,
  handleApiError,
  jobShareRemoveRequestSchema,
  jobShareRequestSchema,
  validateApiKey,
} from "@/lib/api";
import { formatJobShareResponse } from "@/lib/api/formatters/job-share";
import { AuthContext } from "@/lib/auth/utils";
import { jobRepository } from "@/lib/db/repositories";
import { Result } from "@/lib/ts-res";

interface RouteParams {
  params: Promise<{
    jobId: string;
  }>;
}

/**
 * Share a Job
 * @description Share a Job by `jobId` in params
 * @pathParams JobParams
 * @response JobShareSuccessResponse
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
    const { userId, metadata } = await validateApiKey(request.headers);
    const { jobId } = await params;

    if (!jobId) {
      throw new Error("INVALID_INPUT");
    }

    const activeOrganizationId: string | null =
      metadata?.organizationId ?? null;

    // Parse request body
    const body = await request.json();
    const validatedData = jobShareRequestSchema.parse(body);

    // Get the job with authorization check
    const job = await jobRepository.getJobByIdWithAuthCheck(
      jobId,
      userId,
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
      allowSearchIndexing: validatedData.allowSearchIndexing,
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
    return handleApiError(error, "create job share", {
      path: request.nextUrl.pathname,
    });
  }
}

/**
 * Remove job shares
 * @description Remove Job shares by `jobId` in params
 * @pathParams JobParams
 * @response JobShareRemoveSuccessResponse
 * @responseSet public
 * @tag Jobs
 * @auth apikey
 * @openapi
 */
export async function DELETE(
  request: NextRequest,
  { params }: RouteParams,
): Promise<NextResponse> {
  try {
    const { userId, metadata } = await validateApiKey(request.headers);
    const { jobId } = await params;

    if (!jobId) {
      throw new Error("INVALID_INPUT");
    }

    const activeOrganizationId: string | null =
      metadata?.organizationId ?? null;

    // Parse request body
    const body = await request.json();
    const validatedData = jobShareRemoveRequestSchema.parse(body);

    // Get the job with authorization check
    const job = await jobRepository.getJobByIdWithAuthCheck(
      jobId,
      userId,
      activeOrganizationId,
    );

    if (!job) {
      throw new Error("JOB_NOT_FOUND");
    }

    const authContext: AuthContext = {
      userId,
      organizationId: activeOrganizationId,
    };
    let result: Result<void, ActionError>;
    if (validatedData.removeAll) {
      result = await removeSharesPerJob({ jobId, authContext });
    } else {
      const recipientOrganizationId = validatedData.removeOrganizationShare
        ? activeOrganizationId
        : null;
      result = await removeJobShares({
        jobId,
        recipientOrganizationId,
        authContext,
      });
    }
    if (!result.ok) {
      switch (result.error.code) {
        case JobErrorCode.JOB_NOT_FOUND:
          throw new Error("JOB_NOT_FOUND");
        case OrganizationErrorCode.ORGANIZATION_NOT_FOUND:
          throw new Error("ORGANIZATION_NOT_FOUND");
        case OrganizationErrorCode.NOT_ORGANIZATION_MEMBER:
          throw new Error("UNAUTHORIZED");
        default:
          throw new Error(result.error.message ?? "Unknown error");
      }
    }

    // Format and return the job share
    return createApiSuccessResponse({ success: true });
  } catch (error) {
    return handleApiError(error, "remove job shares", {
      path: request.nextUrl.pathname,
    });
  }
}
