"use server";

import { revalidatePath } from "next/cache";

import { ActionError } from "@/lib/actions";
import { agentListRepository } from "@/lib/db/repositories";
import { Ok, Result } from "@/lib/ts-res";
import {
  AuthenticatedRequest,
  withAuthContext,
} from "@/middleware/auth-middleware";
import { AgentListType } from "@/prisma/generated/client";

interface ToggleAgentInAgentListParameters extends AuthenticatedRequest {
  agentId: string;
  listType: AgentListType;
  isBookmarked: boolean;
}

export const toggleAgentInAgentList = withAuthContext<
  ToggleAgentInAgentListParameters,
  Result<void, ActionError>
>(async ({ agentId, listType, isBookmarked, authContext }) => {
  const { userId } = authContext;
  if (isBookmarked) {
    await agentListRepository.removeAgentFromAgentList(
      agentId,
      userId,
      listType,
    );
  } else {
    await agentListRepository.addAgentToAgentList(agentId, userId, listType);
  }

  // Revalidate the app to update the UI
  revalidatePath("/");
  return Ok();
});
