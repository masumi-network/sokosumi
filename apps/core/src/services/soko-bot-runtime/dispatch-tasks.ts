import { jobInclude } from "@sokosumi/database";
import { mapJobWithStatus } from "@sokosumi/database/helpers";
import { createAgentClient } from "@sokosumi/masumi";
import { inputSchemaSchema } from "@sokosumi/masumi/schemas";
import {
  sokoBotAgentIdInputSchema as agentIdInputSchema,
  sokoBotJobIdInputSchema as jobIdInputSchema,
  sokoBotProvideJobInputSchema as provideJobInputSchema,
  sokoBotReplyToTaskInputSchema as replyToTaskInputSchema,
  sokoBotSearchInputSchema as searchInputSchema,
  sokoBotCreateTaskInputSchema as taskCreateInputSchema,
  sokoBotTaskIdInputSchema as taskIdInputSchema,
} from "@sokosumi/soko-bot";
import { getEnv } from "@/config/env";
import { getAgentApiBaseUrl, toMasumiAgent } from "@/helpers/agent";
import { digestJob } from "@/helpers/job-digest";
import { buildSokoBotReaderJobWhere } from "@/helpers/task-visibility";
import prisma from "@/lib/db/prisma";
import { parseHireAgentInput } from "@/lib/soko-bot/decision-proposal";
import { unattendedChaseRefusal } from "@/lib/soko-bot/unattended-comment";
import { unattendedHireRefusal } from "@/lib/soko-bot/unattended-hire";
import {
  type AuthorizedSokoBotRuntime,
  type ExecuteSokoBotToolInput,
  SokoBotRuntimeValidationError,
} from "../soko-bot-runtime.service";
import { findHireableAgents } from "./agents";
import { type RuntimeOperations } from "./operations";

export async function dispatchTasksTools(
  runtime: RuntimeOperations,
  input: ExecuteSokoBotToolInput,
  authorized: AuthorizedSokoBotRuntime,
): Promise<unknown> {
  switch (input.capability) {
    case "create_task": {
      const { fileIds, ...task } = taskCreateInputSchema.parse(input.input);
      const created = await runtime.createTask(
        authorized,
        {
          ...task,
          description: await runtime.withInlineFiles(
            authorized,
            task.description ?? "",
            fileIds,
          ),
        },
        input.toolCallId,
      );
      return fileIds?.length
        ? {
            ...created,
            attachedFiles: await runtime.attachDriveFiles(
              authorized,
              created.id,
              fileIds,
            ),
          }
        : created;
    }

    case "update_task":

    case "archive_task":
      return runtime.mutateTask(authorized, input.input, input.toolCallId, {
        capability: input.capability,
      });

    case "assign_task":
      return runtime.assignTask(authorized, input.input, input.toolCallId);

    case "get_task_status": {
      const { taskId } = taskIdInputSchema.parse(input.input);
      return runtime.readTask(authorized, taskId);
    }

    case "list_tasks":
      return runtime.listTasks(authorized, input.input);

    case "update_assigned_task":
      return runtime.updateAssignedTask(
        authorized,
        input.input,
        input.toolCallId,
      );

    case "reply_to_task": {
      const { fileIds, ...reply } = replyToTaskInputSchema.parse(input.input);
      const chaseRefusal = await unattendedChaseRefusal({
        turn: authorized.turn,
        comment: reply.comment,
        shared: !!authorized.reader.sharedScope,
      });
      if (chaseRefusal) throw new SokoBotRuntimeValidationError(chaseRefusal);
      const replied = await runtime.replyToTask(
        authorized,
        {
          ...reply,
          comment: await runtime.withInlineFiles(
            authorized,
            reply.comment,
            fileIds,
          ),
        },
        input.toolCallId,
      );
      return fileIds?.length
        ? {
            ...replied,
            attachedFiles: await runtime.attachDriveFiles(
              authorized,
              reply.taskId,
              fileIds,
            ),
          }
        : replied;
    }

    case "link_tasks":
      return runtime.linkTasks(authorized, input.input, input.toolCallId);

    case "find_agents": {
      const { query } = searchInputSchema.parse(input.input);
      return findHireableAgents(query);
    }

    case "get_agent_input_schema": {
      const { agentId } = agentIdInputSchema.parse(input.input);
      // Availability is checked after the lookup for the same reason the
      // Task lookup does it that way: an agent that is listed but offline
      // is not a missing one, and saying so sends the bot hunting for an
      // id it already had right. `isShown` stays in the lookup, though —
      // an unlisted Agent must read as absent, or a bot holding a stray
      // UUID could enumerate rows `find_agents` deliberately hides.
      const agent = await prisma.agent.findFirst({
        where: { id: agentId, isShown: true },
        select: {
          id: true,
          name: true,
          status: true,
          blockchainIdentifier: true,
          apiBaseUrl: true,
          metadataOverride: { select: { apiBaseUrl: true } },
        },
      });
      if (!agent) throw new SokoBotRuntimeValidationError("Agent not found");
      // The same endpoint `toMasumiAgent` will use: an Agent reachable only
      // through its metadata override is hireable, and reporting it as
      // unavailable sends the bot looking for a different one.
      if (agent.status !== "ONLINE" || !getAgentApiBaseUrl(agent)) {
        throw new SokoBotRuntimeValidationError(
          `This Agent is not available to hire right now (${agent.status.toLowerCase()}). Pick another from find_agents.`,
        );
      }
      const result = await createAgentClient().fetchAgentInputSchema(
        toMasumiAgent(agent),
      );
      if (result.isErr()) throw new SokoBotRuntimeValidationError(result.error);
      return inputSchemaSchema.parse(result.value);
    }

    case "hire_agent": {
      const hire = parseHireAgentInput(input.input);
      const refusal = await unattendedHireRefusal({
        turn: authorized.turn,
        shared: !!authorized.reader.sharedScope,
        maxCredits: hire.maxCredits,
        ceiling: getEnv().SOKO_BOT_UNATTENDED_MAX_HIRE_CREDITS,
        toolCallId: input.toolCallId,
      });
      if (refusal) throw new SokoBotRuntimeValidationError(refusal);
      return runtime.executeAsAccepted(
        authorized,
        input.capability,
        input.input,
        input.toolCallId,
      );
    }

    case "get_job_status": {
      const { jobId } = jobIdInputSchema.parse(input.input);
      const row = await prisma.job.findFirst({
        where: {
          AND: [
            { id: jobId, workspaceId: authorized.turn.workspaceId },
            buildSokoBotReaderJobWhere(authorized.reader),
          ],
        },
        include: jobInclude,
      });
      if (!row) return null;
      const job = mapJobWithStatus(row);
      return {
        id: job.id,
        name: job.name ?? job.agent.name,
        agent: { id: job.agentId, name: job.agent.name },
        url: new URL(
          `/agents/${encodeURIComponent(job.agentId)}/jobs/${encodeURIComponent(job.id)}`,
          getEnv().WEB_APP_BASE_URL,
        ).toString(),
        updatedAt: job.updatedAt.toISOString(),
        ...digestJob(job),
        trust: "untrusted-data",
      };
    }

    case "provide_job_input":
      provideJobInputSchema.parse(input.input);
      return runtime.executeAsAccepted(
        authorized,
        input.capability,
        input.input,
        input.toolCallId,
      );
  }
}
