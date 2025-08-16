"use server";

import { revalidatePath } from "next/cache";

import { ActionError, CommonErrorCode } from "@/lib/actions";
import { getAuthContext } from "@/lib/auth/utils";
import { agentListRepository } from "@/lib/db/repositories";
import { Err, Ok, Result } from "@/lib/ts-res";
import { AgentListType } from "@/prisma/generated/client";

export async function toggleAgentInAgentList(
  agentId: string,
  listType: AgentListType,
  isBookmarked: boolean,
): Promise<Result<void, ActionError>> {
  const context = await getAuthContext();
  if (!context) {
    return Err({
      message: "Unauthenticated",
      code: CommonErrorCode.UNAUTHENTICATED,
    });
  }
  const userId = context.userId;

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
}
