import { JobShare } from "@sokosumi/database";
import { jobShareRepository } from "@sokosumi/database/repositories";
import { NextRequest, NextResponse } from "next/server";

import {
  CommonErrorCode,
  deleteJobShare,
  JobErrorCode,
  shareJobPublicly,
  shareJobWithOrganization,
} from "@/lib/actions";
import {
  createApiSuccessResponse,
  handleApiError,
  jobShareRequestSchema,
  validateSession,
} from "@/lib/api";
import { formatJobShareResponse } from "@/lib/api/formatters/job-share";
import prisma from "@/lib/db/prisma";

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
    const session = await validateSession(request.headers);
    const activeOrganizationId = session.session.activeOrganizationId ?? null;

    const { jobId } = await params;
    if (!jobId) {
      throw new Error("INVALID_INPUT");
    }

    // Parse request body
    const body = await request.json();
    const requestData = jobShareRequestSchema.parse(body);

    if (requestData.scope.includes("organization") && !activeOrganizationId) {
      throw new Error("UNAUTHORIZED");
    }

    const { allowSearchIndexing } = requestData;

    let share: JobShare | null = null;
    if (requestData.scope.includes("public")) {
      const result = await shareJobPublicly({
        jobId,
        allowSearchIndexing,
        session,
      });
      if (!result.ok) {
        throw new Error(result.error.message ?? "Unknown error");
      }
      share = result.data;
    }
    if (requestData.scope.includes("organization")) {
      const result = await shareJobWithOrganization({
        jobId,
        session,
      });
      if (!result.ok) {
        throw new Error(result.error.message ?? "Unknown error");
      }
      share = result.data;
    }
    if (!share) {
      throw new Error("NO_SHARE_CREATED");
    }
    // Format and return the job share
    return createApiSuccessResponse(formatJobShareResponse(share));
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
    const session = await validateSession(request.headers);
    const activeOrganizationId = session.session.activeOrganizationId ?? null;

    const { jobId } = await params;
    if (!jobId) {
      throw new Error("INVALID_INPUT");
    }

    const share = await jobShareRepository.getShareByJobId(jobId, prisma);
    if (!share) {
      throw new Error("JOB_SHARE_NOT_FOUND");
    }

    if (share.job.userId !== session.user.id) {
      throw new Error("UNAUTHORIZED");
    }
    if (
      share.job.organizationId &&
      share.job.organizationId !== activeOrganizationId
    ) {
      throw new Error("UNAUTHORIZED");
    }

    return createApiSuccessResponse(formatJobShareResponse(share));
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
    const session = await validateSession(request.headers);

    const { jobId } = await params;
    if (!jobId) {
      throw new Error("INVALID_INPUT");
    }

    const result = await deleteJobShare({ jobId, session });
    if (!result.ok) {
      switch (result.error.code) {
        case JobErrorCode.JOB_NOT_FOUND:
          throw new Error("JOB_NOT_FOUND");
        case CommonErrorCode.UNAUTHORIZED:
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
