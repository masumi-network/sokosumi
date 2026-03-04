"use server";

import { AgentListType } from "@sokosumi/database";
import { agentListRepository } from "@sokosumi/database/repositories";
import { revalidatePath } from "next/cache";

import { ActionError } from "@/lib/actions";
import prisma from "@/lib/db/prisma";
import { Ok, Result } from "@/lib/ts-res";
import {
  AuthenticatedRequest,
  withSession,
} from "@/middleware/auth-middleware";

interface ToggleAgentInAgentListParameters extends AuthenticatedRequest {
  agentId: string;
  listType: AgentListType;
  isBookmarked: boolean;
}

export const toggleAgentInAgentList = withSession<
  ToggleAgentInAgentListParameters,
  Result<void, ActionError>
>(async ({ agentId, listType, isBookmarked, session }) => {
  const userId = session.user.id;
  if (isBookmarked) {
    await agentListRepository.removeAgentFromAgentList(
      agentId,
      userId,
      listType,
      prisma,
    );
  } else {
    await agentListRepository.addAgentToAgentList(
      agentId,
      userId,
      listType,
      prisma,
    );
  }

  // Revalidate the app to update the UI
  revalidatePath("/");
  return Ok();
});
