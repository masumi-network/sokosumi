import type { Prisma } from "@sokosumi/database";
import { parseSokoBotMemory, SOKO_BOT_MEMORY_LIMITS } from "@sokosumi/soko-bot";
import { z } from "zod";

const captureSource = z.object({
  source: z.literal("CHAT"),
  sokoBotId: z.string().min(1),
  contextSnapshot: z.object({
    packet: z.object({
      trigger: z.object({
        source: z.literal("CHAT"),
        askedBy: z.object({ kind: z.literal("OWNER") }),
        savedPreference: z.object({
          instruction: z
            .string()
            .min(1)
            .max(SOKO_BOT_MEMORY_LIMITS.maxEntryLength)
            .refine((line) => !/[\r\n]/.test(line)),
          memoryRevisionId: z.uuid(),
          memoryVersion: z.number().int().positive(),
          memoryHash: z.string().min(1),
        }),
      }),
    }),
  }),
});

/** A Core capture has no model tool call. Verify its persisted revision instead. */
export async function savedPreferenceResponse(
  tx: Prisma.TransactionClient,
  source: unknown,
): Promise<string | null> {
  const parsed = captureSource.safeParse(source);
  if (!parsed.success) return null;
  const { trigger } = parsed.data.contextSnapshot.packet;
  const { instruction, memoryRevisionId, memoryVersion, memoryHash } =
    trigger.savedPreference;
  // Context memory is deliberately clipped. The builder checked the full memory
  // before attaching this proof; verify its exact persisted capture independently.
  const revision = await tx.sokoBotMemoryRevision.findFirst({
    where: {
      id: memoryRevisionId,
      sokoBotId: parsed.data.sokoBotId,
      source: "preference_capture",
      version: memoryVersion,
      hash: memoryHash,
    },
    select: { markdown: true },
  });
  if (
    !revision ||
    !parseSokoBotMemory(revision.markdown, {
      secretHandling: "redact",
    }).preferences.includes(instruction)
  )
    return null;
  return `Saved preference: ${JSON.stringify(instruction)}.`;
}
