"use server";

import { revalidatePath } from "next/cache";

import { getSessionOrThrow } from "@/lib/auth/utils";
import {
  addAgentToAgentList,
  removeAgentFromAgentList,
} from "@/lib/db/agentList/repo";

export async function toggleAgentInList(
  agentId: string,
  listId: string,
  isBookmarked: boolean,
): Promise<{ success: boolean }> {
  try {
    const session = await getSessionOrThrow();
    if (!session) {
      return { success: false };
    }
    const user = session.user;
    if (!user) {
      return { success: false };
    }

    if (isBookmarked) {
      await removeAgentFromAgentList(agentId, listId, user.id);
    } else {
      await addAgentToAgentList(agentId, listId, user.id);
    }

    // Revalidate the app to update the UI
    revalidatePath("/app");
    return { success: true };
  } catch (error) {
    console.error("Error toggling agent in list", error);
    return { success: false };
  }
}
