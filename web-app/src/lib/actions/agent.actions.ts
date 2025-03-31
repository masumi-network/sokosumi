"use server";

import { revalidatePath } from "next/cache";

import {
  addAgentToList,
  removeAgentFromList,
} from "@/lib/db/services/agentList.service";
import { AppRoute } from "@/types/routes";

export async function toggleAgentInList(
  agentId: string,
  listId: string,
  isBookmarked: boolean,
): Promise<{ success: boolean }> {
  try {
    if (isBookmarked) {
      await removeAgentFromList(agentId, listId);
    } else {
      await addAgentToList(agentId, listId);
    }

    // Revalidate the app to update the UI
    revalidatePath(AppRoute.Home);
    return { success: true };
  } catch (error) {
    console.error("Error toggling agent in list", error);
    return { success: false };
  }
}
