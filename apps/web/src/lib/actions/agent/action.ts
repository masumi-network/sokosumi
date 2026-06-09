"use server";

import { revalidatePath } from "next/cache";

import type { ActionError } from "@/lib/actions";
import { coreClient, toCoreApiActionError } from "@/lib/clients/core.client";
import { Err, Ok, type Result } from "@/lib/ts-res";
import {
  type AuthenticatedRequest,
  withSession,
} from "@/middleware/auth-middleware";

interface ToggleAgentInAgentListParameters extends AuthenticatedRequest {
  agentId: string;
  isBookmarked: boolean;
}

export const toggleAgentInAgentList = withSession<
  ToggleAgentInAgentListParameters,
  Result<void, ActionError>
>(async ({ agentId, isBookmarked }) => {
  // Favorites are the only agent list. Core scopes the mutation to the
  // authenticated caller via the forwarded session cookie.
  try {
    if (isBookmarked) {
      await coreClient.removeFavoriteAgent(agentId);
    } else {
      await coreClient.addFavoriteAgent({ agentId });
    }
  } catch (error) {
    return Err(toCoreApiActionError(error));
  }

  // Revalidate the app to update the UI
  revalidatePath("/");
  return Ok();
});
