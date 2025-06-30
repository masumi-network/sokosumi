"use server";

import { err, ok, Result } from "neverthrow";
import { revalidatePath } from "next/cache";

import { ActionError, CommonErrorCode } from "@/lib/actions/types";
import { getSession } from "@/lib/auth/utils";
import {
  addAgentToAgentListByIdAndUserId,
  removeAgentFromAgentListByIdAndUserId,
} from "@/lib/db/repositories";

export async function toggleAgentInAgentList(
  agentId: string,
  agentListId: string,
  isBookmarked: boolean,
): Promise<Result<void, ActionError>> {
  try {
    const session = await getSession();
    if (!session) {
      return err(
        new ActionError("Unauthenticated", CommonErrorCode.UNAUTHENTICATED),
      );
    }
    const userId = session.user.id;

    if (isBookmarked) {
      await removeAgentFromAgentListByIdAndUserId(agentId, agentListId, userId);
    } else {
      await addAgentToAgentListByIdAndUserId(agentId, agentListId, userId);
    }

    // Revalidate the app to update the UI
    revalidatePath("/app");
    return ok();
  } catch (error) {
    console.error("Error toggling agent in list", error);
    return err(
      new ActionError(
        "Internal server error",
        CommonErrorCode.INTERNAL_SERVER_ERROR,
      ),
    );
  }
}
