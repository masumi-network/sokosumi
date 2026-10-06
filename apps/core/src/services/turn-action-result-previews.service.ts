import * as Sentry from "@sentry/node";
import type { Prisma, SokoBotTurn } from "@sokosumi/database";
import {
  CHAT_RESULT_PREVIEW_LIMIT,
  type ChatResultReference,
  chatResultReferenceSchema,
} from "@sokosumi/soko-bot";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { actionInputHash } from "@/lib/soko-bot/action-receipts";
import { persistedToolResult } from "@/lib/soko-bot/persisted-value";
import { chatResultSnapshotSchema } from "@/schemas/chat-result-preview.schema";
import { resolveChatResultReference } from "@/services/chat-result-preview.service";
import { resolveSokoBotVersion } from "@/services/soko-bot-version.service";

const ACTION_RESULTS: Record<string, ChatResultReference["kind"]> = {
  create_task: "task",
  assign_task: "task",
  update_task: "task",
  reply_to_task: "task",
  update_assigned_task: "task",
  create_schedule: "bot_schedule",
  update_schedule: "bot_schedule",
  create_social_post: "social_post",
  update_social_post: "social_post",
  schedule_social_post: "social_post",
  cancel_social_post: "social_post",
  publish_social_post: "social_post",
  generate_image: "studio_job",
  upload_file: "file",
  hire_agent: "job",
  provide_job_input: "job",
};

/** Fallback for omitted preview calls; only committed receipts identify resources. */
export async function prepareTurnActionResultPreviews(
  turnId: string,
  turn: Pick<
    SokoBotTurn,
    "userId" | "workspaceId" | "versionId" | "requestedByUserId" | "chainDepth"
  >,
  tx: Prisma.TransactionClient,
) {
  if (
    turn.chainDepth > 0 ||
    (turn.requestedByUserId && turn.requestedByUserId !== turn.userId)
  )
    return;
  if (
    !(await resolveSokoBotVersion(turn.versionId)).skills.includes(
      "chat-result-previews",
    )
  )
    return;
  const calls = await tx.sokoBotToolCall.findMany({
    where: { turnId, status: "COMPLETED" },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  const prepared = new Map(
    [...calls].reverse().flatMap((call) => {
      const snapshot =
        call.capability === "preview_result"
          ? chatResultSnapshotSchema.safeParse(call.result)
          : null;
      return snapshot?.success
        ? [
            [
              actionInputHash(snapshot.data.reference),
              { call, snapshot: snapshot.data },
            ] as const,
          ]
        : [];
    }),
  );
  const references = new Map<string, ChatResultReference>();
  for (const call of calls) {
    if (
      call.status !== "COMPLETED" ||
      !call.committedAt ||
      call.verification === "NONE" ||
      !["APPLIED", "ALREADY_SATISFIED"].includes(call.disposition ?? "")
    )
      continue;
    const kind = ACTION_RESULTS[call.capability];
    if (!kind || !call.targetId) continue;
    const jobInput =
      call.capability === "provide_job_input"
        ? await tx.jobInput.findUnique({
            where: { id: call.targetId },
            select: { event: { select: { jobId: true } } },
          })
        : null;
    if (call.capability === "provide_job_input" && !jobInput) continue;
    const project = z.object({ projectId: z.string() }).safeParse(call.result);
    const parsed = chatResultReferenceSchema.safeParse({
      kind,
      id: jobInput?.event.jobId ?? call.targetId,
      ...(kind === "social_post" || kind === "studio_job"
        ? { projectId: project.success ? project.data.projectId : undefined }
        : {}),
    });
    if (parsed.success)
      references.set(actionInputHash(parsed.data), parsed.data);
  }
  let count = prepared.size;
  for (const [key, reference] of references) {
    const existing = prepared.get(key);
    if (!existing && count >= CHAT_RESULT_PREVIEW_LIMIT) continue;
    try {
      // Read after the final action, so create + assignment show one final state.
      const snapshot = await resolveChatResultReference(
        {
          reference,
          actor: {
            userId: turn.userId,
            workspaceId: turn.workspaceId,
            kind: "soko_bot",
          },
          ...(existing ? { previewId: existing.snapshot.data.id } : {}),
        },
        tx,
      );
      const toolCallId = existing?.call.toolCallId ?? `auto-preview:${key}`;
      await tx.sokoBotToolCall.upsert({
        where: { turnId_toolCallId: { turnId, toolCallId } },
        create: {
          turnId,
          toolCallId,
          capability: "preview_result",
          status: "COMPLETED",
          inputHash: actionInputHash({ reference }),
          input: { reference },
          result: persistedToolResult(snapshot),
        },
        update: { result: persistedToolResult(snapshot) },
      });
      if (!existing) count++;
    } catch (error) {
      // Only unavailable or invalid resources are best effort. Database errors
      // must escape so the outer serializable transaction can retry safely.
      if (
        !(error instanceof z.ZodError) &&
        !(
          error instanceof HTTPException &&
          [403, 404, 422].includes(error.status)
        )
      )
        throw error;
      Sentry.captureException(error, {
        tags: { component: "turn-action-result-preview", kind: reference.kind },
      });
    }
  }
}
