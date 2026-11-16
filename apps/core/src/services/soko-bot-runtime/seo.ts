import {
  isSokoBotSeoCapability,
  SOKO_BOT_TOOL_INPUT_SCHEMAS,
} from "@sokosumi/soko-bot";
import prisma from "@/lib/db/prisma";
import { commitActionReceipt } from "@/lib/soko-bot/action-receipts";
import { persistedToolResult } from "@/lib/soko-bot/persisted-value";
import { runSeoTool } from "@/lib/soko-bot/seo-tools";
import {
  RuntimeEventLog,
  runtimeEvent,
  WEB_TAINT_EVENT,
} from "@/lib/soko-bot/turn-loop";
import {
  type AuthorizedSokoBotRuntime,
  type ExecuteSokoBotToolInput,
  SokoBotRuntimeValidationError,
} from "../soko-bot-runtime.service";
import { actingMemberOf, ownerDirectReader } from "./acting-scope";
import type { RuntimeOperations } from "./operations";

export async function executeSeoTool(
  runtime: RuntimeOperations,
  input: ExecuteSokoBotToolInput,
  authorized: AuthorizedSokoBotRuntime,
  replay = false,
): Promise<unknown> {
  if (!isSokoBotSeoCapability(input.capability))
    throw new SokoBotRuntimeValidationError("Unsupported SEO capability");
  const { projectId } = SOKO_BOT_TOOL_INPUT_SCHEMAS[input.capability].parse(
    input.input,
  );
  const workspace = await prisma.workspace.findUniqueOrThrow({
    where: { id: authorized.turn.workspaceId },
    select: { organizationId: true },
  });
  const result = await runSeoTool(
    input.capability,
    input.input,
    {
      owner: { kind: "project", id: projectId },
      workspaceId: authorized.turn.workspaceId,
      userId: actingMemberOf(authorized),
      organizationId: workspace.organizationId,
      sokoBotId: authorized.turn.sokoBotId,
      privateMetricsAllowed: ownerDirectReader(authorized),
    },
    {
      authorize: async (tx) => {
        await runtime.requireMutationAuthority(
          tx,
          authorized,
          false,
          input.capability,
          { projectIds: [projectId] },
        );
      },
      commit: async (tx, targetId, result) => {
        const taskId =
          result &&
          typeof result === "object" &&
          "taskId" in result &&
          typeof result.taskId === "string"
            ? result.taskId
            : undefined;
        await commitActionReceipt(tx, {
          turnId: authorized.turn.id,
          toolCallId: input.toolCallId,
          actorBotId: authorized.turn.sokoBotId,
          targetId,
          result: persistedToolResult({
            projectId,
            id: targetId,
            ...(taskId ? { taskId } : {}),
            link: `/seo?projectId=${encodeURIComponent(projectId)}&view=project`,
          }),
        });
      },
    },
    replay,
  );
  // Stored audit evidence includes text from external pages and providers.
  // Replaying a receipt must retain the same untrusted-input boundary.
  await new RuntimeEventLog(authorized.turn.id, input.sessionId).append(
    runtimeEvent(WEB_TAINT_EVENT, { source: "seo_workspace" }),
  );
  return result;
}
