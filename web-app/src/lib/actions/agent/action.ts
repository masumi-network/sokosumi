"use server";

import { revalidatePath } from "next/cache";

import { ActionError, CommonErrorCode } from "@/lib/actions";
import { getSession } from "@/lib/auth/utils";
import {
  addAgentToAgentListByIdAndUserId,
  removeAgentFromAgentListByIdAndUserId,
} from "@/lib/db/repositories";
import { Err, Ok, Result } from "@/lib/ts-res";
import { AgentListType } from "@/prisma/generated/client";

export async function toggleAgentInAgentList(
  agentId: string,
  listType: AgentListType,
  isBookmarked: boolean,
): Promise<Result<void, ActionError>> {
  try {
    const session = await getSession();
    if (!session) {
      return Err({
        message: "Unauthenticated",
        code: CommonErrorCode.UNAUTHENTICATED,
      });
    }
    const userId = session.user.id;

    if (isBookmarked) {
      await removeAgentFromAgentListByIdAndUserId(agentId, listType, userId);
    } else {
      await addAgentToAgentListByIdAndUserId(agentId, listType, userId);
    }

    // Revalidate the app to update the UI
    revalidatePath("/app");
    return Ok();
  } catch (error) {
    console.error("Error toggling agent in list", error);
    return Err({
      message: "Internal server error",
      code: CommonErrorCode.INTERNAL_SERVER_ERROR,
    });
  }
}
