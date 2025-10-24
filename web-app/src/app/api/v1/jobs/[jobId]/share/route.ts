import { NextRequest, NextResponse } from "next/server";

import {
  JobErrorCode,
  OrganizationErrorCode,
  shareJobPublicly,
  unshareJobPublicly,
} from "@/lib/actions";
import {
  createApiSuccessResponse,
  handleApiError,
  sharePostRequestSchema,
} from "@/lib/api";
import { formatJobPublicShareResponse } from "@/lib/api/formatters/job-share";
import { getAuthContext } from "@/lib/auth/utils";
import { jobShareRepository } from "@/lib/db/repositories";

interface RouteParams {
  params: Promise<{
    jobId: string;
  }>;
}

export async function PUT(
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
    const requestData = sharePostRequestSchema.parse(body);

    // Share the job publicly
    const result = await shareJobPublicly({ jobId, authContext });

    // Handle errors
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
    return createApiSuccessResponse(formatJobPublicShareResponse(result.data));
  } catch (error) {
    return handleApiError(error, "create job share", {
      path: request.nextUrl.pathname,
    });
  }
}

export async function GET(
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

    const share = await jobShareRepository.getShareByJobId(jobId);
    if (!share) {
      throw new Error("JOB_SHARE_NOT_FOUND");
    }
    return createApiSuccessResponse(formatJobPublicShareResponse(share));
  } catch (error) {
    return handleApiError(error, "get job share", {
      path: request.nextUrl.pathname,
    });
  }
}

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

    const result = await unshareJobPublicly({ jobId, authContext });
    if (!result.ok) {
      switch (result.error.code) {
        case JobErrorCode.JOB_NOT_FOUND:
          throw new Error("JOB_NOT_FOUND");
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
