import { createHash } from "node:crypto";
import {
  sokoBotMemoryUpdateInputSchema as memoryUpdateInputSchema,
  parseSokoBotMemory,
  renderSokoBotMemory,
} from "@sokosumi/soko-bot";
import { serializableTransaction } from "@/lib/db/transaction";
import { persistedToolResult } from "@/lib/soko-bot/persisted-value";
import {
  type AuthorizedSokoBotRuntime,
  SokoBotRuntimeConflictError,
  SokoBotRuntimeValidationError,
} from "../soko-bot-runtime.service";
import { type RuntimeOperations } from "./operations";

export function hashMemory(markdown: string): string {
  return createHash("sha256").update(markdown).digest("hex");
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
  return serializableTransaction(async (tx) => {
    await runtime.requireMutationAuthority(
      tx,
      authorized,
      false,
      "update_memory",
    );
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
        result: persistedToolResult(revision),
        actorBotId: authorized.turn.sokoBotId,
        targetId: revision.id,
        disposition: "APPLIED",
        verification: "LOCAL_TRANSACTION",
        committedAt: new Date(),
      },
    });
    return revision;
  }, "Memory changed during turn");
}
