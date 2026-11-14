import {
  isSokoBotNewsletterCapability,
  isSokoBotSeoCapability,
  SOKO_BOT_TOOL_INPUT_SCHEMAS,
} from "@sokosumi/soko-bot";
import { tableBatchSchema, tableMutationSchema } from "@sokosumi/utils";
import { z } from "zod";
import { readTableOperation } from "@/helpers/data-table";
import prisma from "@/lib/db/prisma";
import { serializableTransaction } from "@/lib/db/transaction";
import {
  ACTION_CAPABILITIES,
  actionInputHash,
  actionOperationKey,
  EXTERNAL_EFFECT_CAPABILITIES,
  externalActionReceipt,
  verifyTaskArchiveReceipt,
} from "@/lib/soko-bot/action-receipts";
import {
  assertEvaluationActor,
  assertEvaluationTool,
} from "@/lib/soko-bot/evaluation-dispatch";
import { persistedToolResult } from "@/lib/soko-bot/persisted-value";
import { chatResultSnapshotSchema } from "@/schemas/chat-result-preview.schema";
import { socialPostSchema } from "@/schemas/social-post.schema";
import { hydrateChatResultSnapshots } from "@/services/chat-result-preview.service";
import { listSocialAccountStatistics } from "@/services/social-account-statistics.service";
import { getSocialPost } from "@/services/social-posts.service";
import {
  type ExecuteSokoBotToolInput,
  pinToBotProject,
  SokoBotRefusedUnsentError,
  SokoBotRuntimeAuthorizationError,
  SokoBotRuntimeConflictError,
} from "../soko-bot-runtime.service";
import { actingMemberOf, actionPrincipalId } from "./acting-scope";
import {
  CORE_READ_CALLS,
  CORE_READ_CAPABILITIES,
  CORE_WRITE_CALLS,
  READ_CALLS_PER_WRITE_CALL,
  TOOL_CALL_STALE_MS,
} from "./execution-limits";
import { type RuntimeOperations } from "./operations";
import { persistedErrorDetail } from "./seller-recovery";
import { normalizeCreateTableInput } from "./table-create-input";

export async function executeTool(
  runtime: RuntimeOperations,
  rawInput: ExecuteSokoBotToolInput,
): Promise<unknown> {
  const authorized = await runtime.authorize(rawInput);
  let input = await pinToBotProject(rawInput, authorized.turn.sokoBotId);
  if (isSokoBotNewsletterCapability(input.capability)) {
    // Before any receipt lookup, so a replay is refused like a first call.
    const { projectId } = SOKO_BOT_TOOL_INPUT_SCHEMAS[input.capability].parse(
      input.input,
    );
    await runtime.requireNewsletterScope(
      authorized,
      input.capability,
      projectId,
    );
  }
  assertEvaluationActor({
    ...authorized.turn,
    userId: authorized.turn.actingUserId,
    clientTurnId: authorized.turn.id,
  });
  assertEvaluationTool(input.capability, input.input);
  const inputHash = actionInputHash(input.input ?? null);
  const operationKey = ACTION_CAPABILITIES.has(input.capability)
    ? actionOperationKey({
        workspaceId: authorized.turn.workspaceId,
        principalId: actionPrincipalId(authorized.turn),
        intentRevision: authorized.turn.intentId
          ? `${authorized.turn.intentId}:${authorized.turn.intentRevision}`
          : authorized.turn.id,
        capability: input.capability,
        inputHash,
      })
    : null;
  let existing = await prisma.sokoBotToolCall.findUnique({
    where: {
      turnId_toolCallId: {
        turnId: input.turnId,
        toolCallId: input.toolCallId,
      },
    },
  });
  // A later attempt may have committed the same intent after this call failed.
  // Reuse that receipt before reopening the older rejected call's unique key.
  if (
    existing?.status === "FAILED" &&
    existing.inputHash === inputHash &&
    existing.capability === input.capability &&
    existing.disposition === "REJECTED" &&
    existing.verification === "NONE" &&
    !existing.committedAt &&
    operationKey
  ) {
    const operation = await prisma.sokoBotToolCall.findUnique({
      where: { operationKey },
    });
    if (operation) existing = operation;
  }
  if (!existing) {
    existing = await serializableTransaction(async (tx) => {
      await tx.$queryRaw`
          SELECT "id"
          FROM "soko_bot_turn"
          WHERE "id" = ${input.turnId}::uuid
          FOR UPDATE
        `;
      const raced = await tx.sokoBotToolCall.findUnique({
        where: {
          turnId_toolCallId: {
            turnId: input.turnId,
            toolCallId: input.toolCallId,
          },
        },
      });
      if (raced) return raced;
      if (operationKey) {
        const operation = await tx.sokoBotToolCall.findUnique({
          where: { operationKey },
        });
        if (operation) return operation;
      }
      const isRead = CORE_READ_CAPABILITIES.includes(input.capability);
      const callCount = await tx.sokoBotToolCall.count({
        where: {
          turnId: input.turnId,
          ...(isRead ? CORE_READ_CALLS : CORE_WRITE_CALLS),
        },
      });
      const limit = isRead
        ? authorized.toolCallLimit * READ_CALLS_PER_WRITE_CALL
        : authorized.toolCallLimit;
      if (callCount >= limit) {
        throw new SokoBotRuntimeConflictError(
          "Soko Bot turn tool-call limit reached",
        );
      }
      await tx.sokoBotToolCall.create({
        data: {
          turnId: input.turnId,
          toolCallId: input.toolCallId,
          capability: input.capability,
          operationKey,
          actorBotId: authorized.turn.sokoBotId,
          inputHash,
          input: persistedToolResult(input.input ?? null),
        },
      });
      return null;
    }, "Soko Bot tool-call reservation collided with another call");
  }
  if (existing) {
    if (
      existing.inputHash !== inputHash ||
      existing.capability !== input.capability
    ) {
      throw new SokoBotRuntimeAuthorizationError(
        "Tool call id was reused with different input",
      );
    }
    if (existing.disposition === "UNKNOWN") {
      throw new SokoBotRuntimeConflictError(
        "Effect outcome is unknown; reconciliation is required before retrying",
      );
    }
    if (existing.status === "COMPLETED") {
      if (isSokoBotSeoCapability(input.capability)) {
        return runtime.executeSeoTool(input, authorized, true);
      }
      let replayResult = existing.result;
      if (input.capability === "preview_result") {
        if (authorized.askedByKind !== "OWNER")
          throw new SokoBotRuntimeAuthorizationError(
            "Result previews are prepared for the owner's requests",
          );
        const snapshot = chatResultSnapshotSchema.parse(existing.result);
        const [preview] = await hydrateChatResultSnapshots(
          [snapshot],
          actingMemberOf(authorized),
        );
        if (!preview || preview.state !== "available")
          throw new SokoBotRuntimeAuthorizationError("Result unavailable");
        return { ...snapshot, data: preview };
      }
      if (
        [
          "create_social_post",
          "update_social_post",
          "schedule_social_post",
          "cancel_social_post",
          "publish_social_post",
          "refresh_social_post_statistics",
          "refresh_social_account_statistics",
        ].includes(input.capability)
      ) {
        await runtime.requireSocialAccess(authorized);
      }
      const adWrite = (
        [
          "create_ad_campaign",
          "update_ad_campaign",
          "edit_ad_campaign",
          "delete_ad_campaign",
        ] as const
      ).find((capability) => capability === input.capability);
      if (adWrite)
        await runtime.requireAdsAccess(
          authorized,
          SOKO_BOT_TOOL_INPUT_SCHEMAS[adWrite].parse(input.input).projectId,
        );
      if (input.capability === "refresh_social_post_statistics") {
        const params =
          SOKO_BOT_TOOL_INPUT_SCHEMAS.refresh_social_post_statistics.parse(
            input.input,
          );
        // Recheck project access and return the cache without another provider fetch.
        return socialPostSchema.parse(
          await getSocialPost({
            ...params,
            workspaceId: authorized.turn.workspaceId,
          }),
        );
      }
      if (input.capability === "refresh_social_account_statistics") {
        const params =
          SOKO_BOT_TOOL_INPUT_SCHEMAS.refresh_social_account_statistics.parse(
            input.input,
          );
        const result = await listSocialAccountStatistics({
          projectId: params.projectId,
          connectionId: params.connectionId,
          workspaceId: authorized.turn.workspaceId,
          limit: 1,
        });
        const account = result.accounts.find(
          (account) => account.id === params.connectionId,
        );
        if (!account)
          throw new SokoBotRuntimeAuthorizationError(
            "Social account is no longer available",
          );
        return { account, importedPostCount: 0 };
      }
      if (
        input.capability === "list_tables" ||
        input.capability === "read_table"
      ) {
        return runtime.executeAuthorizedTool(input);
      }
      if (
        input.capability === "list_project_social_accounts" ||
        input.capability === "get_posting_instructions" ||
        input.capability === "list_ad_accounts" ||
        input.capability === "list_ad_campaigns" ||
        input.capability === "find_ad_targeting" ||
        input.capability === "get_market_keywords" ||
        input.capability === "get_ad_campaign" ||
        input.capability === "list_social_posts" ||
        input.capability === "list_social_post_statistics" ||
        input.capability === "list_social_account_statistics" ||
        input.capability === "get_social_post"
      ) {
        const result = await runtime.executeAuthorizedTool(input);
        await prisma.sokoBotToolCall.updateMany({
          where: {
            turnId: input.turnId,
            toolCallId: input.toolCallId,
            status: "COMPLETED",
          },
          data: { result: persistedToolResult(result) },
        });
        return result;
      }
      if (
        ["create_table", "write_table_rows", "update_table_columns"].includes(
          input.capability,
        )
      ) {
        const actor = await runtime.tableActor(authorized, input.input);
        let key: string;
        let request: unknown;
        if (input.capability === "create_table") {
          const body = normalizeCreateTableInput(input.input);
          key = body.key;
          request = { create: body };
        } else {
          const { tableId } = z
            .object({ tableId: z.uuid() })
            .parse(input.input);
          if (input.capability === "write_table_rows") {
            const body = tableBatchSchema.parse(input.input);
            key = body.key;
            request = {
              id: tableId,
              batch: body,
              taskId: actor.taskId ?? body.taskId,
            };
          } else {
            const body = tableMutationSchema.parse(input.input);
            const { removeColumnIds } =
              SOKO_BOT_TOOL_INPUT_SCHEMAS.update_table_columns.parse(
                input.input,
              );
            key = body.key;
            request = removeColumnIds?.length
              ? { id: tableId, metadata: body, removeColumnIds }
              : { id: tableId, metadata: body };
          }
        }
        const operation = await readTableOperation(actor, key, request);
        if (existing.targetId && operation.tableId !== existing.targetId)
          throw new SokoBotRuntimeConflictError("Table receipt target changed");
        replayResult =
          input.capability === "create_table"
            ? {
                table: operation.result,
                url: `/drive/tables/${operation.tableId}`,
                instruction:
                  "Table created. Present this link now; enrich in bounded batches. Reuse this table ID for follow-ups.",
              }
            : operation.result;
      }
      if (
        input.capability === "archive_task" &&
        !(await verifyTaskArchiveReceipt(
          prisma,
          existing.replayedReceiptId ?? existing.id,
        ))
      ) {
        throw new SokoBotRuntimeConflictError(
          "Archived task history could not be verified",
        );
      }
      if (
        operationKey &&
        (existing.turnId !== input.turnId ||
          existing.toolCallId !== input.toolCallId)
      ) {
        await prisma.sokoBotToolCall.upsert({
          where: {
            turnId_toolCallId: {
              turnId: input.turnId,
              toolCallId: input.toolCallId,
            },
          },
          create: {
            turnId: input.turnId,
            toolCallId: input.toolCallId,
            capability: input.capability,
            actorBotId: authorized.turn.sokoBotId,
            inputHash,
            input: persistedToolResult(input.input ?? null),
            result: persistedToolResult(existing.result),
            status: "COMPLETED",
            replayedReceiptId: existing.replayedReceiptId ?? existing.id,
            disposition: "ALREADY_SATISFIED",
            verification: "NONE",
          },
          // Never replace a real action receipt with a replay marker.
          update: {},
        });
      }
      return replayResult;
    }
    if (
      existing.status === "FAILED" &&
      !EXTERNAL_EFFECT_CAPABILITIES.has(input.capability) &&
      existing.disposition === "REJECTED" &&
      existing.verification === "NONE" &&
      !existing.committedAt
    ) {
      const reopened = await prisma.sokoBotToolCall.updateMany({
        where: {
          id: existing.id,
          status: "FAILED",
          disposition: "REJECTED",
          verification: "NONE",
          committedAt: null,
        },
        data: {
          status: "PENDING",
          disposition: null,
          operationKey,
          errorKind: null,
          errorDetail: null,
        },
      });
      if (reopened.count !== 1)
        throw new SokoBotRuntimeConflictError(
          "Tool call retry was claimed concurrently",
        );
    } else {
      if (existing.status === "FAILED") {
        throw new SokoBotRuntimeConflictError("Tool call previously failed");
      }
      if (EXTERNAL_EFFECT_CAPABILITIES.has(input.capability)) {
        await prisma.sokoBotToolCall.updateMany({
          where: {
            id: existing.id,
            status: "PENDING",
            updatedAt: { lt: new Date(Date.now() - TOOL_CALL_STALE_MS) },
          },
          data: {
            status: "FAILED",
            disposition: "UNKNOWN",
            verification: "NONE",
          },
        });
        throw new SokoBotRuntimeConflictError(
          "Effect outcome is unknown; reconciliation is required before retrying",
        );
      }
      if (existing.turnId && existing.turnId !== input.turnId) {
        throw new SokoBotRuntimeConflictError(
          "Previous-turn operation requires reconciliation before retrying",
        );
      }
      const reclaimed = await prisma.sokoBotToolCall.updateMany({
        where: {
          id: existing.id,
          status: "PENDING",
          updatedAt: {
            lt: new Date(Date.now() - TOOL_CALL_STALE_MS),
          },
        },
        data: {
          updatedAt: new Date(),
          errorKind: null,
          errorDetail: null,
        },
      });
      if (reclaimed.count === 0) {
        throw new SokoBotRuntimeConflictError("Tool call is already executing");
      }
    }
    // A semantic retry may carry a new call id. The original reserved row
    // remains authoritative for its transaction and finalization.
    if (existing.toolCallId)
      input = { ...input, toolCallId: existing.toolCallId };
  }

  if (
    input.capability === "generate_image" ||
    input.capability === "generate_video"
  ) {
    try {
      if (input.capability === "generate_image")
        await runtime.checkImageRequest(
          authorized,
          input.input,
          input.toolCallId,
        );
      else
        await runtime.checkVideoRequest(
          authorized,
          input.input,
          input.toolCallId,
        );
    } catch (error) {
      // Refused before anything was sent: rejected, and the same request
      // may be made again once whatever refused it has changed.
      await prisma.sokoBotToolCall.updateMany({
        where: {
          turnId: input.turnId,
          toolCallId: input.toolCallId,
          status: "PENDING",
        },
        data: {
          status: "FAILED",
          disposition: "REJECTED",
          operationKey: null,
          errorKind: error instanceof Error ? error.name : "unknown",
          errorDetail: persistedErrorDetail(error),
        },
      });
      throw error;
    }
  }
  const externalEffect = EXTERNAL_EFFECT_CAPABILITIES.has(input.capability);
  if (externalEffect) {
    // Fence cancellation and capability revocation at the durable dispatch
    // boundary. A crash after this commit remains UNKNOWN, never retryable.
    await serializableTransaction(async (tx) => {
      await runtime.requireMutationAuthority(
        tx,
        authorized,
        false,
        input.capability,
      );
      const reserved = await tx.sokoBotToolCall.updateMany({
        where: {
          turnId: input.turnId,
          toolCallId: input.toolCallId,
          status: "PENDING",
        },
        data: { disposition: "UNKNOWN", verification: "NONE" },
      });
      if (reserved.count !== 1)
        throw new SokoBotRuntimeConflictError(
          "External action reservation is unavailable",
        );
    }, "External action reservation changed concurrently");
  }
  try {
    const result = await runtime.executeAuthorizedTool(input);
    await prisma.sokoBotToolCall.updateMany({
      where: {
        turnId: input.turnId,
        toolCallId: input.toolCallId,
        ...(externalEffect
          ? {
              status: { in: ["PENDING", "COMPLETED"] },
              disposition: "UNKNOWN",
              verification: "NONE",
            }
          : { status: "PENDING" }),
      },
      data: {
        ...(externalEffect
          ? externalActionReceipt(input.capability, result)
          : {}),
        status: "COMPLETED",
        result: persistedToolResult(result ?? null),
      },
    });
    return result;
  } catch (error) {
    const refusedUnsent = error instanceof SokoBotRefusedUnsentError;
    await prisma.sokoBotToolCall.updateMany({
      where: {
        turnId: input.turnId,
        toolCallId: input.toolCallId,
        ...(externalEffect
          ? {
              status: { in: ["PENDING", "COMPLETED"] },
              disposition: "UNKNOWN",
              verification: "NONE",
            }
          : { status: "PENDING" }),
      },
      data: {
        status: "FAILED",
        // A rolled-back local attempt is not an enduring semantic
        // reservation, and neither is an effect refused before it was sent.
        ...(!externalEffect || refusedUnsent ? { operationKey: null } : {}),
        disposition: ACTION_CAPABILITIES.has(input.capability)
          ? EXTERNAL_EFFECT_CAPABILITIES.has(input.capability) && !refusedUnsent
            ? "UNKNOWN"
            : "REJECTED"
          : undefined,
        errorKind: error instanceof Error ? error.name : "unknown",
        errorDetail: persistedErrorDetail(error),
      },
    });
    throw error;
  }
}
