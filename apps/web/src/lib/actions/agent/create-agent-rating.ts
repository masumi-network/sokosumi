"use server";

import { err, ok } from "neverthrow";
import { revalidatePath } from "next/cache";
import {
  type ActionResultDto,
  toActionResult,
} from "@/lib/actions/action-result";

import { getSession } from "@/lib/auth/auth.server";
import { CoreApiRequestError, coreClient } from "@/lib/clients/core.client";

export interface AgentRatingError {
  code:
    | "UNAUTHORIZED"
    | "INVALID_RATING"
    | "INVALID_INPUT"
    | "NOT_ELIGIBLE"
    | "AGENT_NOT_FOUND"
    | "UNKNOWN";
  message: string;
}

function mapCoreErrorToRatingError(
  error: CoreApiRequestError,
): AgentRatingError {
  switch (error.status) {
    case 401:
      return {
        code: "UNAUTHORIZED",
        message: "You must be logged in to rate an agent",
      };
    case 403:
      return {
        code: "NOT_ELIGIBLE",
        message:
          "You must complete at least one job with this agent before rating",
      };
    case 404:
      return { code: "AGENT_NOT_FOUND", message: "Agent not found" };
    case 422:
      return {
        code: "INVALID_RATING",
        message: "Rating must be an integer between 1 and 5",
      };
    default:
      return {
        code: "UNKNOWN",
        message: "An unexpected error occurred while submitting your rating",
      };
  }
}

export async function createAgentRating(
  agentId: string,
  rating: number,
  comment?: string,
): Promise<ActionResultDto<void, AgentRatingError>> {
  try {
    // Validate session
    const session = await getSession();
    if (!session) {
      return toActionResult(
        err({
          code: "UNAUTHORIZED",
          message: "You must be logged in to rate an agent",
        }),
      );
    }

    // Validate rating
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      return toActionResult(
        err({
          code: "INVALID_RATING",
          message: "Rating must be an integer between 1 and 5",
        }),
      );
    }

    // Validate comment length
    if (comment && comment.length > 1000) {
      return toActionResult(
        err({
          code: "INVALID_INPUT",
          message: "Comment must be 1000 characters or less",
        }),
      );
    }

    // Core enforces the eligibility gate (a finished job with the agent) and
    // upserts the rating server-side.
    await coreClient.createAgentRating(agentId, {
      rating,
      comment: comment ?? null,
    });

    // Revalidate relevant paths
    revalidatePath(`/agents/${agentId}`, "layout");
    revalidatePath("/agents");

    return toActionResult(ok(undefined));
  } catch (error) {
    if (error instanceof CoreApiRequestError) {
      return toActionResult(err(mapCoreErrorToRatingError(error)));
    }
    console.error("Error creating agent rating:", error);
    return toActionResult(
      err({
        code: "UNKNOWN",
        message: "An unexpected error occurred while submitting your rating",
      }),
    );
  }
}
