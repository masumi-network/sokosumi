import { sharedTable } from "@sokosumi/database/sql-tables";
import { simulateReadableStream, type streamText } from "ai";
import { z } from "zod";
import { jsonInput } from "@/helpers/prisma-json";
import prisma from "@/lib/db/prisma";

/**
 * Mira, each eval lane's research Coworker. Her host is under `.invalid`,
 * which never resolves; Core answers her chat mentions in process with the
 * replies the running case scripted (`setEvalCoworkerScript`), one per
 * question, so an agent-to-agent case is the same every run and costs nothing
 * on her side.
 */
export const EVAL_COWORKER = {
  name: "Mira",
  baseURL: "https://coworker.eval.invalid",
  description:
    "Research Coworker: desk research, market and competitor comparisons, written briefs. Answers questions in chat.",
} as const;

const scriptSchema = z.object({
  replies: z.array(z.string().nullable()),
  next: z.number().int().min(0),
});

export function isEvalCoworkerBaseUrl(baseURL: string): boolean {
  return baseURL.trim() === EVAL_COWORKER.baseURL;
}

export async function setEvalCoworkerScript(
  coworkerId: string,
  replies: (string | null)[],
): Promise<void> {
  await prisma.coworker.update({
    where: { id: coworkerId },
    data: { metadata: jsonInput({ evalScript: { replies, next: 0 } }) },
  });
}

/**
 * Mira's next scripted reply, consumed. Null when the case scripted no answer
 * or she has none left: she stays silent, as a Coworker who never answers.
 */
export async function takeEvalCoworkerReply(
  coworkerId: string,
): Promise<string | null> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT id FROM ${sharedTable("coworker")} WHERE id = ${coworkerId} FOR UPDATE`;
    const row = await tx.coworker.findUnique({
      where: { id: coworkerId },
      select: { metadata: true },
    });
    const metadata = z
      .object({ evalScript: scriptSchema })
      .safeParse(row?.metadata);
    if (!metadata.success) return null;
    const { replies, next } = metadata.data.evalScript;
    await tx.coworker.update({
      where: { id: coworkerId },
      data: {
        metadata: jsonInput({ evalScript: { replies, next: next + 1 } }),
      },
    });
    return replies[next] ?? null;
  });
}

type StreamModel = Parameters<typeof streamText>[0]["model"];

/** A model that streams one fixed text, so Mira's reply takes the real reply path. */
export function scriptedReplyModel(text: string): StreamModel {
  const usage = {
    inputTokens: {
      total: 0,
      noCache: 0,
      cacheRead: undefined,
      cacheWrite: undefined,
    },
    outputTokens: { total: 0, text: 0, reasoning: undefined },
  };
  const finishReason = { unified: "stop" as const, raw: "stop" };
  return {
    specificationVersion: "v3",
    provider: "eval",
    modelId: "eval-coworker",
    supportedUrls: {},
    doGenerate: async () => ({
      content: [{ type: "text", text }],
      finishReason,
      usage,
      warnings: [],
    }),
    doStream: async () => ({
      stream: simulateReadableStream({
        chunks: [
          { type: "stream-start" as const, warnings: [] },
          { type: "text-start" as const, id: "0" },
          { type: "text-delta" as const, id: "0", delta: text },
          { type: "text-end" as const, id: "0" },
          { type: "finish" as const, finishReason, usage },
        ],
      }),
    }),
  };
}
