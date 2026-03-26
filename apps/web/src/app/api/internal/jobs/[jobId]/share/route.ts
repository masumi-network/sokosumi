import {
  jobRepository,
  jobShareRepository,
} from "@sokosumi/database/repositories";
import { NextRequest, NextResponse } from "next/server";
import superJson from "superjson";

import {
  createApiEmptyResponse,
  createApiSuccessResponse,
  handleApiError,
} from "@/lib/api";
import { getSession } from "@/lib/auth/utils";
import prisma from "@/lib/db/prisma";

interface RouteParams {
  params: Promise<{
    jobId: string;
  }>;
}

async function requireOwnedJob(jobId: string) {
  const session = await getSession();
  if (!session) {
    throw new Error("UNAUTHORIZED");
  }

  const job = await jobRepository.getJobById(jobId, prisma);
  if (!job) {
    throw new Error("JOB_NOT_FOUND");
  }

  if (job.userId !== session.user.id) {
    throw new Error("UNAUTHORIZED");
  }

  return job;
}

export async function POST(
  request: NextRequest,
  { params }: RouteParams,
): Promise<NextResponse> {
  try {
    const { jobId } = await params;
    if (!jobId) {
      throw new Error("INVALID_INPUT");
    }

    await requireOwnedJob(jobId);
    const share = await prisma.$transaction(async (tx) => {
      return await jobShareRepository.upsertPublicShare(jobId, true, tx);
    });

    return createApiSuccessResponse(superJson.stringify(share));
  } catch (error) {
    return handleApiError(error, "create job share", {
      path: request.nextUrl.pathname,
    });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: RouteParams,
): Promise<NextResponse> {
  try {
    const { jobId } = await params;
    if (!jobId) {
      throw new Error("INVALID_INPUT");
    }

    const body = (await request.json()) as { allowSearchIndexing?: unknown };
    if (typeof body.allowSearchIndexing !== "boolean") {
      throw new Error("INVALID_INPUT");
    }

    const job = await requireOwnedJob(jobId);
    if (!job.share) {
      throw new Error("JOB_SHARE_NOT_FOUND");
    }

    const share = await prisma.$transaction(async (tx) => {
      return await jobShareRepository.setShareAllowSearchIndexingById(
        job.share.id,
        body.allowSearchIndexing,
        tx,
      );
    });

    return createApiSuccessResponse(superJson.stringify(share));
  } catch (error) {
    return handleApiError(error, "update job share", {
      path: request.nextUrl.pathname,
    });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: RouteParams,
): Promise<NextResponse> {
  try {
    const { jobId } = await params;
    if (!jobId) {
      throw new Error("INVALID_INPUT");
    }

    await requireOwnedJob(jobId);
    await prisma.$transaction(async (tx) => {
      await jobShareRepository.deleteShareByJobId(jobId, tx);
    });

    return createApiEmptyResponse({ status: 200 });
  } catch (error) {
    return handleApiError(error, "delete job share", {
      path: request.nextUrl.pathname,
    });
  }
}
