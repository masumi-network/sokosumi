"use server";

import { revalidatePath } from "next/cache";

import { getAuthContext } from "@/lib/auth/utils";
import { agentService } from "@/lib/services";
import { Err, Ok, Result } from "@/lib/ts-res";

export interface AgentRatingError {
  code:
    | "UNAUTHORIZED"
    | "INVALID_RATING"
    | "NOT_ELIGIBLE"
    | "AGENT_NOT_FOUND"
    | "UNKNOWN";
  message: string;
}

export async function createAgentRating(
  agentId: string,
  rating: number,
  comment?: string,
): Promise<Result<void, AgentRatingError>> {
  try {
    // Validate session
    const authContext = await getAuthContext();
    if (!authContext?.userId) {
      return Err({
        code: "UNAUTHORIZED",
        message: "You must be logged in to rate an agent",
      });
    }

    // Validate rating
    if (!Number.isInteger(rating) || rating < 0 || rating > 5) {
      return Err({
        code: "INVALID_RATING",
        message: "Rating must be an integer between 0 and 5",
      });
    }

    // Validate agent exists
    const agent = await agentService.getAvailableAgentById(agentId);
    if (!agent) {
      return Err({
        code: "AGENT_NOT_FOUND",
        message: "Agent not found",
      });
    }

    // Check eligibility
    const canRate = await agentService.canUserRateAgent(
      authContext.userId,
      agentId,
    );
    if (!canRate) {
      return Err({
        code: "NOT_ELIGIBLE",
        message:
          "You must complete at least one job with this agent before rating",
      });
    }

    // Submit the rating
    await agentService.submitAgentRating(agentId, rating, comment ?? null);

    // Revalidate relevant paths
    revalidatePath(`/agents/${agentId}`);
    revalidatePath("/agents");

    return Ok(undefined);
  } catch (error) {
    console.error("Error creating agent rating:", error);
    return Err({
      code: "UNKNOWN",
      message: "An unexpected error occurred while submitting your rating",
    });
  }
}
