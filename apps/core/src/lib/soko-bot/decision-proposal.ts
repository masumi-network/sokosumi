import { inputSchemaSchema } from "@sokosumi/masumi/schemas";
import {
  sokoBotHireAgentInputSchema as hireAgentInputSchema,
  sokoBotProvideJobInputSchema as provideJobInputSchema,
  type SokoBotDecisionTarget,
  sokoBotArchiveTaskInputSchema as taskArchiveInputSchema,
  sokoBotAssignTaskInputSchema as taskAssignInputSchema,
  sokoBotCreateTaskInputSchema as taskCreateInputSchema,
  sokoBotUpdateTaskInputSchema as taskUpdateInputSchema,
} from "@sokosumi/soko-bot";
import prisma from "@/lib/db/prisma";
import type { SokoBotWriteTargets } from "@/lib/soko-bot/write-scope";

export function parseHireAgentInput(input: unknown) {
  const parsed = hireAgentInputSchema.parse(input);
  return {
    ...parsed,
    inputSchema: inputSchemaSchema.parse(parsed.inputSchema),
  };
}

export function parseDecisionProposal(
  toolName: SokoBotDecisionTarget,
  proposal: unknown,
) {
  switch (toolName) {
    case "create_task":
      return taskCreateInputSchema.parse(proposal);
    case "update_task":
      return taskUpdateInputSchema.parse(proposal);
    case "archive_task":
      return taskArchiveInputSchema.parse(proposal);
    case "assign_task":
      return taskAssignInputSchema.parse(proposal);
    case "hire_agent":
      return parseHireAgentInput(proposal);
    case "provide_job_input":
      return provideJobInputSchema.parse(proposal);
  }
}

function decisionReason(
  toolName: SokoBotDecisionTarget,
  proposal: unknown,
): string {
  switch (toolName) {
    case "create_task": {
      const input = taskCreateInputSchema.parse(proposal);
      return `Create ${input.status} Task`;
    }
    case "update_task": {
      const input = taskUpdateInputSchema.parse(proposal);
      return `Update Task ${input.taskId}`;
    }
    case "archive_task": {
      const input = taskArchiveInputSchema.parse(proposal);
      return `Archive Task ${input.taskId} (retain history)`;
    }
    case "assign_task": {
      const input = taskAssignInputSchema.parse(proposal);
      return `Assign Task ${input.taskId} to Coworker ${input.coworkerId}`;
    }
    case "hire_agent": {
      const input = parseHireAgentInput(proposal);
      return `Hire Agent ${input.agentId} with a maximum of ${input.maxCredits} credits`;
    }
    case "provide_job_input": {
      const input = provideJobInputSchema.parse(proposal);
      return `Send approved input to Agent Job ${input.jobId}`;
    }
  }
}

/**
 * Owner-facing approval text: names instead of ids where they resolve, and
 * the plain id otherwise. Names are display data, never authorization.
 */
export async function describeDecision(
  toolName: SokoBotDecisionTarget,
  proposal: unknown,
): Promise<string> {
  const quote = (name: string | null | undefined, id: string) =>
    name?.trim() ? `"${name.trim()}"` : id;
  try {
    switch (toolName) {
      case "assign_task": {
        const input = taskAssignInputSchema.parse(proposal);
        const [task, coworker] = await Promise.all([
          prisma.task.findUnique({
            where: { id: input.taskId },
            select: { name: true },
          }),
          prisma.coworker.findUnique({
            where: { id: input.coworkerId },
            select: { name: true },
          }),
        ]);
        return `Assign Task ${quote(task?.name, input.taskId)} to Coworker ${quote(coworker?.name, input.coworkerId)}${input.ready ? " and start it" : ""}`;
      }
      case "archive_task":
      case "update_task": {
        const input =
          toolName === "archive_task"
            ? taskArchiveInputSchema.parse(proposal)
            : taskUpdateInputSchema.parse(proposal);
        const task = await prisma.task.findUnique({
          where: { id: input.taskId },
          select: { name: true },
        });
        return `${toolName === "archive_task" ? "Archive" : "Update"} Task ${quote(task?.name, input.taskId)}`;
      }
      case "hire_agent": {
        const input = parseHireAgentInput(proposal);
        const agent = await prisma.agent.findUnique({
          where: { id: input.agentId },
          select: { name: true },
        });
        return `Hire Agent ${quote(agent?.name, input.agentId)} with a maximum of ${input.maxCredits} credits`;
      }
      default:
        return decisionReason(toolName, proposal);
    }
  } catch {
    return decisionReason(toolName, proposal);
  }
}

/**
 * The Tasks, Projects and Job a decision proposal writes to. `create_task`
 * without a Project files the Task outside every Project; `update_task`
 * without one leaves the Task's Project as it is.
 */
export function decisionProposalTargets(
  toolName: SokoBotDecisionTarget,
  proposal: unknown,
): SokoBotWriteTargets {
  switch (toolName) {
    case "create_task": {
      const input = taskCreateInputSchema.parse(proposal);
      return {
        taskIds: [input.triggeringTaskId],
        projectIds: [input.projectId ?? null],
      };
    }
    case "update_task": {
      const input = taskUpdateInputSchema.parse(proposal);
      return {
        taskIds: [input.taskId],
        projectIds: input.projectId === undefined ? [] : [input.projectId],
      };
    }
    case "archive_task":
      return { taskIds: [taskArchiveInputSchema.parse(proposal).taskId] };
    case "assign_task":
      return { taskIds: [taskAssignInputSchema.parse(proposal).taskId] };
    case "hire_agent": {
      // A hire with no Project is the bot's own Job and stays in scope.
      const { projectId } = hireAgentInputSchema.parse(proposal);
      return { projectIds: projectId ? [projectId] : [] };
    }
    case "provide_job_input":
      return { jobId: provideJobInputSchema.parse(proposal).jobId };
  }
}
