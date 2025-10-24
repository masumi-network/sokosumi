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
import { jobPublicShareRepository } from "@/lib/db/repositories";

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

    // Check if the job is already shared publicly
    const hasShare = await jobPublicShareRepository.hasShareByJobId(jobId);

    // Share the job publicly
    const result = await shareJobPublicly({
      jobId,
      allowSearchIndexing: requestData.allowSearchIndexing,
      authContext,
    });

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
    return createApiSuccessResponse(formatJobPublicShareResponse(result.data), {
      status: hasShare ? 200 : 201,
    });
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

    const publicShare = await jobPublicShareRepository.getShareByJobId(jobId);
    if (!publicShare) {
      throw new Error("JOB_PUBLIC_SHARE_NOT_FOUND");
    }
    return createApiSuccessResponse(formatJobPublicShareResponse(publicShare));
  } catch (error) {
    return handleApiError(error, "get job public share", {
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
