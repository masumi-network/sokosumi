import { NextRequest, NextResponse } from "next/server";

import {
  shareJobWithOrganization,
  unshareJobWithOrganization,
} from "@/lib/actions";
import { createApiSuccessResponse, handleApiError } from "@/lib/api/utils";
import { getAuthContext } from "@/lib/auth/utils";

interface RouteParams {
  params: Promise<{
    jobId: string;
  }>;
}

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

    const result = await shareJobWithOrganization({
      jobId,
      authContext,
    });
    if (!result.ok) {
      throw new Error(result.error.message ?? "Unknown error");
    }
    return createApiSuccessResponse({ success: true }, { status: 201 });
  } catch (error) {
    return handleApiError(error, "share job organization", {
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

    const result = await unshareJobWithOrganization({
      jobId,
      authContext,
    });
    if (!result.ok) {
      throw new Error(result.error.message ?? "Unknown error");
    }
    return createApiSuccessResponse({ success: true }, { status: 200 });
  } catch (error) {
    return handleApiError(error, "unshare job organization", {
      path: request.nextUrl.pathname,
    });
  }
}
