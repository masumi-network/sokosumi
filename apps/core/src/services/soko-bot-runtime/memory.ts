import { createHash } from "node:crypto";
import {
  sokoBotMemoryUpdateInputSchema as memoryUpdateInputSchema,
  parseSokoBotMemory,
  renderSokoBotMemory,
  SOKO_BOT_MEMORY_LIMITS,
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
    const directHumanRequest =
      authorized.turn.source === "CHAT" &&
      authorized.turn.chainDepth === 0 &&
      authorized.turn.requestedByUserId !== null &&
      (authorized.askedByKind === "OWNER" ||
        (Boolean(authorized.reader.sharedScope) &&
          authorized.askedByKind === "TEAMMATE"));
    const preserveOwnerMemory = !directHumanRequest;
    const latestRevision =
      bot.memoryVersion > 0 &&
      (preserveOwnerMemory ||
        bot.memoryVersion !== authorized.grant.memoryVersion)
        ? await tx.sokoBotMemoryRevision.findUnique({
            where: {
              sokoBotId_version: {
                sokoBotId: authorized.turn.sokoBotId,
                version: bot.memoryVersion,
              },
            },
            select: { sourceTurnId: true, markdown: true },
          })
        : null;
    if (bot.memoryVersion !== authorized.grant.memoryVersion) {
      if (
        bot.memoryVersion < authorized.grant.memoryVersion ||
        latestRevision?.sourceTurnId !== authorized.turn.id
      ) {
        throw new SokoBotRuntimeConflictError("Memory changed during turn");
      }
    }
    let nextMarkdown = markdown;
    if (preserveOwnerMemory && bot.memoryVersion > 0) {
      if (!latestRevision)
        throw new SokoBotRuntimeConflictError(
          "Current memory revision is unavailable",
        );
      // Background summaries can be clipped or incomplete. Only a direct human
      // request can remove preferences or goals from the current stored revision.
      const previous = parseSokoBotMemory(latestRevision.markdown);
      const next = parseSokoBotMemory(markdown);
      for (const section of ["preferences", "activeGoals"] as const) {
        next[section] = [...new Set([...previous[section], ...next[section]])];
        if (next[section].length > SOKO_BOT_MEMORY_LIMITS.maxEntriesPerSection)
          throw new SokoBotRuntimeValidationError(
            `Existing ${section === "preferences" ? "preferences" : "active goals"} must be retained; ask for a direct human memory update before replacing them`,
          );
      }
      try {
        nextMarkdown = renderSokoBotMemory(next);
      } catch (error) {
        throw new SokoBotRuntimeValidationError(
          error instanceof Error ? error.message : "Soko Bot memory is invalid",
        );
      }
    }
    const hash = hashMemory(nextMarkdown);
    const version = bot.memoryVersion + 1;
    const revision = await tx.sokoBotMemoryRevision.create({
      data: {
        sokoBotId: authorized.turn.sokoBotId,
        sourceTurnId: authorized.turn.id,
        version,
        hash,
        markdown: nextMarkdown,
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
