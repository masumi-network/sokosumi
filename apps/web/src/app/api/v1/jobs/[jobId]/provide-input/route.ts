import { NextRequest, NextResponse } from "next/server";
import * as z from "zod";

import {
  createApiSuccessResponse,
  handleApiError,
  validateApiKey,
} from "@/lib/api";
import { jobService } from "@/lib/services/job.service";

interface RouteParams {
  params: Promise<{
    jobId: string;
  }>;
}

const requestSchema = z.object({
  statusId: z.string(),
  inputData: z.record(
    z.string(),
    z.union([
      z.number(),
      z.string(),
      z.array(z.string()),
      z.boolean(),
      z.array(z.number()),
      z.instanceof(File),
      z.array(z.instanceof(File)),
      z.undefined(),
    ]),
  ),
});

/**
 * Provide input for a job awaiting human-in-the-loop input
 * @description Submits input data for a job that is in the awaiting_input state.
 * This is used for human-in-the-loop workflows where an agent requests additional input.
 * @pathParams JobParams
 * @body ProvideInputRequest
 * @response ProvideInputSuccessResponse
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
    const { userId } = await validateApiKey(request.headers);
    const { jobId } = await params;

    if (!jobId) {
      throw new Error("INVALID_INPUT");
    }

    // Parse and validate request body
    const body = await request.json();
    const parseResult = requestSchema.safeParse(body);

    if (!parseResult.success) {
      throw parseResult.error;
    }

    const { statusId, inputData } = parseResult.data;

    // Call the job service to provide input
    const { job } = await jobService.provideJobInput({
      jobId,
      statusId,
      userId,
      inputData,
    });

    return createApiSuccessResponse({ jobId: job.id });
  } catch (error) {
    return handleApiError(error, "provide job input", {
      path: request.nextUrl.pathname,
    });
  }
}
