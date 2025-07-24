import { NextRequest, NextResponse } from "next/server";

import { getNextLatestSequenceId } from "@/lib/db/repositories";
import { retrieveJobStatus } from "@/lib/db/repositories/job";

export async function GET(req: NextRequest) {
  const jobId = req.nextUrl.searchParams.get("jobId");
  if (!jobId) {
    return NextResponse.json(
      { message: "Job ID is required" },
      { status: 400 },
    );
  }

  try {
    const jobStatus = await retrieveJobStatus(jobId);
    const sequenceId = await getNextLatestSequenceId();
    return NextResponse.json({
      jobStatus,
      sequenceId,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    return NextResponse.json(
      { message: message || "Failed to get agent input schema" },
      { status: 500 },
    );
  }
}
