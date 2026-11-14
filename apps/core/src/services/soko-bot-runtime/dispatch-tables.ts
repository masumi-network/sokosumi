import { SOKO_BOT_TOOL_INPUT_SCHEMAS } from "@sokosumi/soko-bot";
import {
  createDataTableSchema,
  tableBatchSchema,
  tableMutationSchema,
  tableQuerySchema,
} from "@sokosumi/utils";
import { v5 as uuidv5 } from "uuid";
import { z } from "zod";
import {
  batchTableRows,
  createDataTable,
  listDataTables,
  mutateDataTable,
  queryTableRows,
  requireDataTable,
  type TableOperationCompletion,
} from "@/helpers/data-table";
import {
  actionInputHash,
  commitActionReceipt,
} from "@/lib/soko-bot/action-receipts";
import { persistedToolResult } from "@/lib/soko-bot/persisted-value";
import { dataTableSchema } from "@/schemas/data-table.schema";
import {
  type AuthorizedSokoBotRuntime,
  type ExecuteSokoBotToolInput,
  SokoBotRuntimeAuthorizationError,
  SokoBotRuntimeConflictError,
  SokoBotRuntimeValidationError,
} from "../soko-bot-runtime.service";
import { CORE_WRITE_CALLS } from "./execution-limits";
import { type RuntimeOperations } from "./operations";

export async function dispatchTablesTools(
  runtime: RuntimeOperations,
  input: ExecuteSokoBotToolInput,
  authorized: AuthorizedSokoBotRuntime,
): Promise<unknown> {
  switch (input.capability) {
    case "list_tables":

    case "read_table":

    case "create_table":

    case "write_table_rows":

    case "update_table_columns": {
      const scopedActor = await runtime.tableActor(authorized, input.input);
      const { taskId } = scopedActor;
      const actor = scopedActor;
      if (input.capability === "list_tables")
        return listDataTables(
          scopedActor,
          z
            .object({
              cursor: z.uuid().optional(),
              limit: z.number().int().min(1).max(100).optional(),
            })
            .parse(input.input),
        );
      const complete: TableOperationCompletion = async (tx, operation) => {
        await runtime.requireMutationAuthority(
          tx,
          authorized,
          false,
          input.capability,
          { taskIds: [taskId] },
        );
        const table =
          input.capability === "create_table"
            ? dataTableSchema.parse(operation.result)
            : null;
        const result = table
          ? {
              table,
              url: `/drive/tables/${table.id}`,
              instruction:
                "Table created. Present this link now; enrich in bounded batches. Reuse this table ID for follow-ups.",
            }
          : operation.result;
        if (table) {
          const turn = await tx.sokoBotTurn.findUnique({
            where: { id: authorized.turn.id },
            select: {
              chatMention: {
                select: { message: { select: { roomId: true } } },
              },
            },
          });
          const publications = [
            ...(turn?.chatMention
              ? [
                  {
                    capability: "post_chat" as const,
                    destination: turn.chatMention.message.roomId,
                  },
                ]
              : []),
            ...(taskId
              ? [
                  {
                    capability: "reply_to_task" as const,
                    destination: taskId,
                  },
                ]
              : []),
          ];
          for (const publication of publications) {
            // Table creation never grants independent chat/task write permission.
            if (
              !authorized.grant.capabilities.includes(publication.capability)
            ) {
              throw new SokoBotRuntimeAuthorizationError(
                "Table link publication requires its own capability grant",
              );
            }
            await runtime.requireMutationAuthority(
              tx,
              authorized,
              false,
              publication.capability,
            );
            const kind =
              publication.capability === "post_chat" ? "chat" : "task";
            const publicationId = uuidv5(
              `table-created:${kind}:${publication.destination}:${actor.actorId}`,
              table.id,
            );
            const childToolCallId = `${input.toolCallId}:table-link:${kind}`;
            const content =
              kind === "chat"
                ? `[${table.title.replaceAll("[", "").replaceAll("]", "")}](/drive/tables/${table.id})`
                : `[Open table](/drive/tables/${table.id})`;
            const childInput =
              publication.capability === "post_chat"
                ? { roomId: publication.destination, content }
                : { taskId: publication.destination, comment: content };
            const childInputHash = actionInputHash(childInput);
            const child = await tx.sokoBotToolCall.upsert({
              where: {
                turnId_toolCallId: {
                  turnId: authorized.turn.id,
                  toolCallId: childToolCallId,
                },
              },
              create: {
                turnId: authorized.turn.id,
                toolCallId: childToolCallId,
                capability: publication.capability,
                actorBotId: actor.actorId,
                inputHash: childInputHash,
                input: persistedToolResult(childInput),
                status: "PENDING",
              },
              update: {},
            });
            if (
              child.capability !== publication.capability ||
              child.inputHash !== childInputHash
            ) {
              throw new SokoBotRuntimeAuthorizationError(
                "Table link tool call ID was reused with different input",
              );
            }
            if (child.status === "COMPLETED") continue;
            if (
              (await tx.sokoBotToolCall.count({
                where: { turnId: authorized.turn.id, ...CORE_WRITE_CALLS },
              })) > authorized.toolCallLimit
            ) {
              throw new SokoBotRuntimeConflictError(
                "Soko Bot turn tool-call limit reached",
              );
            }
            if (publication.capability === "post_chat") {
              await runtime.postChat(
                authorized,
                {
                  roomId: publication.destination,
                  content,
                  toolCallId: childToolCallId,
                  publicationId,
                },
                tx,
              );
            } else {
              await runtime.replyToTask(
                authorized,
                { taskId: publication.destination, comment: content },
                childToolCallId,
                { transaction: tx, publicationId },
              );
            }
          }
        }
        await commitActionReceipt(tx, {
          turnId: authorized.turn.id,
          toolCallId: input.toolCallId,
          actorBotId: actor.actorId,
          targetId: operation.tableId,
          disposition: operation.replayed ? "ALREADY_SATISFIED" : "APPLIED",
          result: persistedToolResult(result),
        });
      };
      if (input.capability === "create_table") {
        const table = await createDataTable(
          scopedActor,
          createDataTableSchema.parse(input.input),
          complete,
        );
        return {
          table,
          url: `/drive/tables/${table.id}`,
          instruction:
            "Table created. Present this link now; enrich in bounded batches. Reuse this table ID for follow-ups.",
        };
      }
      const { tableId } = z
        .object({ tableId: z.uuid(), taskId: z.string().optional() })
        .parse(input.input);
      if (input.capability === "read_table")
        return {
          table: dataTableSchema.parse(
            await requireDataTable(scopedActor, tableId),
          ),
          ...(await queryTableRows(
            scopedActor,
            tableId,
            tableQuerySchema.parse(input.input),
          )),
        };
      if (input.capability === "write_table_rows")
        return batchTableRows(
          scopedActor,
          tableId,
          tableBatchSchema.parse(input.input),
          complete,
        );
      const { removeColumnIds } =
        SOKO_BOT_TOOL_INPUT_SCHEMAS.update_table_columns.parse(input.input);
      // Deleting columns deletes their data: only on the owner's word.
      const { isOwnerDirected } = await import("@/lib/soko-bot/turn-loop");
      if (
        removeColumnIds?.length &&
        !(await isOwnerDirected(authorized.turn.id))
      )
        throw new SokoBotRuntimeValidationError(
          "Columns are only deleted when the owner asks in chat; ask them first",
        );
      return mutateDataTable(
        scopedActor,
        tableId,
        { ...tableMutationSchema.parse(input.input), removeColumnIds },
        complete,
      );
    }
  }
}
