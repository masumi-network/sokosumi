"use server";

import { TaskStatus } from "@sokosumi/database";
import { revalidatePath } from "next/cache";

import { openrouterClient } from "@/lib/clients/openrouter.client";
import { taskService } from "@/lib/services/task.service";
import {
  type AuthenticatedRequest,
  withAuthContext,
} from "@/middleware/auth-middleware";

interface CreateTaskParameters extends AuthenticatedRequest {
  description: string;
  orchestratorId: string | null;
  orchestratorName: string;
  status: TaskStatus;
}

function buildFallbackName(description: string): string {
  const firstLine = description.split("\n").find((line) => line.trim());

  return (firstLine ?? "").trim().slice(0, 60);
}

export const createTask = withAuthContext<
  CreateTaskParameters,
  { taskId: string }
>(
  async ({
    description,
    orchestratorId,
    orchestratorName: _orchestratorName,
    status,
  }) => {
    const trimmedDescription = description.trim();
    if (!trimmedDescription) {
      throw new Error("Description required");
    }

    try {
      const generatedName =
        await openrouterClient.generateTaskName(trimmedDescription);
      const candidate = generatedName ?? buildFallbackName(description);
      const name = candidate.trim() || "Untitled Task";
      const task = await taskService.createTask({
        name,
        description: trimmedDescription,
        orchestratorId: orchestratorId?.trim() ? orchestratorId : null,
      });

      if (status === TaskStatus.READY) {
        await taskService.createTaskEvent(task.id, {
          status: TaskStatus.READY,
        });
      }

      revalidatePath("/tasks");
      return { taskId: task.id };
    } catch (error) {
      console.error("Failed to create task", error);
      throw new Error("Failed to create task");
    }
  },
);
