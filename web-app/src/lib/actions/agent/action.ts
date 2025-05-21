"use server";

import { revalidatePath } from "next/cache";

import { addAgentToAgentList, removeAgentFromAgentList } from "@/lib/db";

export async function toggleAgentInList(
  agentId: string,
  listId: string,
  isBookmarked: boolean,
): Promise<{ success: boolean }> {
  try {
    if (isBookmarked) {
      await removeAgentFromAgentList(agentId, listId);
    } else {
      await addAgentToAgentList(agentId, listId);
    }

    // Revalidate the app to update the UI
    revalidatePath("/app");
    return { success: true };
  } catch (error) {
    console.error("Error toggling agent in list", error);
    return { success: false };
  }
}
