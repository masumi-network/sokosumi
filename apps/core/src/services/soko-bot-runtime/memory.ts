import { createHash } from "node:crypto";
import { type Prisma } from "@sokosumi/database";
import {
  sokoBotMemoryUpdateInputSchema as memoryUpdateInputSchema,
  parseSokoBotMemory,
  renderSokoBotMemory,
  sanitizeSokoBotMemoryMarkdown,
  sokoBotMemoryNotKept,
} from "@sokosumi/soko-bot";
import prisma from "@/lib/db/prisma";
import { serializableTransaction } from "@/lib/db/transaction";
import { persistedToolResult } from "@/lib/soko-bot/persisted-value";
import { TOOL_RESULT_SHORTENED_EVENT } from "@/lib/soko-bot/tool-result-fit";
import {
  type AuthorizedSokoBotRuntime,
  SokoBotRuntimeConflictError,
  SokoBotRuntimeValidationError,
} from "../soko-bot-runtime.service";
import { type RuntimeOperations } from "./operations";

export function hashMemory(markdown: string): string {
  return createHash("sha256").update(markdown).digest("hex");
}

/**
 * The bot's memory as read_memory returns it: the newest revision, or the
 * one a replayed read pinned. A replay rereads it, because the stored result
 * is cut at 16 KB and would hand the model a preview without the document.
 */
export async function readMemory(
  sokoBotId: string,
  revisionId?: string,
): Promise<{
  id: string;
  version: number;
  hash: string;
  markdown: string;
} | null> {
  const revision = await prisma.sokoBotMemoryRevision.findFirst({
    where: { sokoBotId, ...(revisionId ? { id: revisionId } : {}) },
    orderBy: { version: "desc" },
    select: { id: true, version: true, hash: true, markdown: true },
  });
  if (!revision) return null;
  const markdown = sanitizeSokoBotMemoryMarkdown(revision.markdown);
  return { ...revision, markdown, hash: hashMemory(markdown) };
}

/**
 * The context packet shows at most part of a long memory, and update_memory
 * replaces the whole document: a write built from that part would erase the
 * rest. Such a turn reads its memory first.
 */
async function requireWholeMemorySeen(
  tx: Prisma.TransactionClient,
  turnId: string,
): Promise<void> {
  const snapshot = await tx.sokoBotContextSnapshot.findUnique({
    where: { turnId },
    select: { omissions: true },
  });
  const omitted = (snapshot?.omissions as Record<string, unknown> | null)
    ?.memory;
  if (typeof omitted !== "number" || omitted <= 0) return;
  // One query at a time: an interactive transaction runs no two at once.
  const reads = await tx.sokoBotToolCall.findMany({
    // A script's read (`script:` id) reached a script, not the model.
    where: {
      turnId,
      capability: "read_memory",
      status: "COMPLETED",
      NOT: { toolCallId: { startsWith: "script:" } },
    },
    select: { toolCallId: true },
  });
  const shortened = await tx.sokoBotRuntimeEvent.findMany({
    where: { turnId, type: TOOL_RESULT_SHORTENED_EVENT },
    select: { data: true },
  });
  const cut = new Set(
    shortened.map(
      (event) => (event.data as { callId?: unknown } | null)?.callId,
    ),
  );
  if (!reads.some((read) => !cut.has(read.toolCallId)))
    throw new SokoBotRuntimeValidationError(
      "Nothing was saved: your context showed only part of your memory, and update_memory replaces all of it. Call read_memory, then save the whole document with your change.",
    );
}

export async function updateMemory(
  runtime: RuntimeOperations,
  authorized: AuthorizedSokoBotRuntime,
  rawInput: unknown,
  toolCallId: string,
) {
  const input = memoryUpdateInputSchema.parse(rawInput);
  let markdown: string;
  try {
    markdown = renderSokoBotMemory(
      parseSokoBotMemory(input.markdown, {
        secretHandling: "reject",
        unknownSections: "reject",
      }),
    );
  } catch (error) {
    throw new SokoBotRuntimeValidationError(
      error instanceof Error ? error.message : "Soko Bot memory is invalid",
    );
  }
  const hash = hashMemory(markdown);
  const notKept = sokoBotMemoryNotKept(input.markdown);
  return serializableTransaction(async (tx) => {
    await runtime.requireMutationAuthority(
      tx,
      authorized,
      false,
      "update_memory",
    );
    await requireWholeMemorySeen(tx, authorized.turn.id);
    const bot = await tx.sokoBot.findUniqueOrThrow({
      where: { id: authorized.turn.sokoBotId },
      select: { memoryVersion: true },
    });
    if (bot.memoryVersion !== authorized.grant.memoryVersion) {
      const latestRevision =
        bot.memoryVersion > authorized.grant.memoryVersion
          ? await tx.sokoBotMemoryRevision.findUnique({
              where: {
                sokoBotId_version: {
                  sokoBotId: authorized.turn.sokoBotId,
                  version: bot.memoryVersion,
                },
              },
              select: { sourceTurnId: true },
            })
          : null;
      if (latestRevision?.sourceTurnId !== authorized.turn.id) {
        throw new SokoBotRuntimeConflictError("Memory changed during turn");
      }
    }
    const version = bot.memoryVersion + 1;
    const revision = await tx.sokoBotMemoryRevision.create({
      data: {
        sokoBotId: authorized.turn.sokoBotId,
        sourceTurnId: authorized.turn.id,
        version,
        hash,
        markdown,
        source: "runtime",
      },
      select: { id: true, version: true, hash: true, markdown: true },
    });
    const result = notKept.length
      ? {
          ...revision,
          notKept,
          note: "Saved, but these did not fit: merge or shorten them and save again if they still matter.",
        }
      : revision;
    await tx.sokoBot.update({
      where: { id: authorized.turn.sokoBotId },
      data: { memoryVersion: version, memoryHash: hash },
    });
    await tx.sokoBotToolCall.update({
      where: {
        turnId_toolCallId: { turnId: authorized.turn.id, toolCallId },
      },
      data: {
        status: "COMPLETED",
        result: persistedToolResult(result),
        actorBotId: authorized.turn.sokoBotId,
        targetId: revision.id,
        disposition: "APPLIED",
        verification: "LOCAL_TRANSACTION",
        committedAt: new Date(),
      },
    });
    return result;
  }, "Memory changed during turn");
}
