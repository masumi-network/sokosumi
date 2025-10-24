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
} from "@/lib/api";
import { formatJobShareResponse } from "@/lib/api/formatters/job-share";
import { getAuthContext } from "@/lib/auth/utils";
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
    const authContext = await getAuthContext();
    if (!authContext) {
      throw new Error("UNAUTHORIZED");
    }

    const { jobId } = await params;
    if (!jobId) {
      throw new Error("INVALID_INPUT");
    }

    // Parse request body
    const body = await request.json();
    const requestData = jobShareRequestSchema.parse(body);

    let recipientOrganizationId: string | null = null;
    for (const scope of requestData.scopes) {
      switch (scope) {
        case "organization":
          recipientOrganizationId = authContext.organizationId;
          if (!recipientOrganizationId) {
            throw new Error("ORGANIZATION_NOT_FOUND");
          }
          break;
        case "public":
          break;
        default:
          throw new Error("INVALID_INPUT");
      }
    }

    const result = await shareJob({
      jobId,
      recipientOrganizationId,
      allowSearchIndexing: requestData.allowSearchIndexing,
      authContext,
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
    const authContext = await getAuthContext();
    if (!authContext) {
      throw new Error("UNAUTHORIZED");
    }

    const { jobId } = await params;
    if (!jobId) {
      throw new Error("INVALID_INPUT");
    }

    // Parse request body
    const body = await request.json();
    const requestData = jobShareRemoveRequestSchema.parse(body);

    let result: Result<void, ActionError>;
    if (requestData.scopes.length === 2) {
      result = await removeSharesPerJob({ jobId, authContext });
    } else {
      result = await removeJobShares({
        jobId,
        recipientOrganizationId: authContext.organizationId,
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
