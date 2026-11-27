import { randomUUID } from "node:crypto";
import * as Sentry from "@sentry/node";
import type { Prisma, SokoBotTurn } from "@sokosumi/database";
import {
  ACTION_RESULT_CARD_KINDS,
  ACTION_RESULT_REMOVAL_KINDS,
  CHAT_RESULT_PREVIEW_LIMIT,
  type ChatResultReference,
  chatResultReferenceSchema,
  versionShowsResultCards,
} from "@sokosumi/soko-bot";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { sokoBotActingUserId } from "@/lib/soko-bot/acting-user";
import { actionInputHash } from "@/lib/soko-bot/action-receipts";
import { persistedToolResult } from "@/lib/soko-bot/persisted-value";
import { chatResultSnapshotSchema } from "@/schemas/chat-result-preview.schema";
import { resolveChatResultReference } from "@/services/chat-result-preview.service";
import { resolveSokoBotVersion } from "@/services/soko-bot-version.service";

const LEGACY_ACTION_RESULTS: Record<string, ChatResultReference["kind"]> = {
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
  generate_video: "studio_job",
  generate_talking_video: "studio_job",
  upload_file: "file",
  move_file: "file",
  delete_file: "file",
  save_email_attachment: "file",
  hire_agent: "job",
  provide_job_input: "job",
  request_seo_analysis: "task",
  create_seo_action_task: "task",
};

const LEGACY_REMOVALS: Readonly<Record<string, ChatResultReference["kind"]>> = {
  archive_task: "task",
  delete_schedule: "bot_schedule",
};

/** Fallback for omitted preview calls; only committed receipts identify resources. */
export async function prepareTurnActionResultPreviews(
  turnId: string,
  turn: Pick<
    SokoBotTurn,
    | "requestedByUserId"
    | "workspaceId"
    | "versionId"
    | "askedByUserId"
    | "chainDepth"
  > & { sokoBot: { userId: string | null } },
  tx: Prisma.TransactionClient,
) {
  const actingUserId = sokoBotActingUserId(turn);
  // Previews are for the owner who asked; a turn for nobody has no reader.
  if (
    actingUserId === null ||
    turn.chainDepth > 0 ||
    (turn.askedByUserId && turn.askedByUserId !== actingUserId)
  )
    return;
  const version = await resolveSokoBotVersion(turn.versionId);
  if (!versionShowsResultCards(version)) return;
  const autoCards = version.autoResultCards === true;
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
  // A later archive or delete in this turn is the resource's final state.
  const removed = new Set<string>();
  for (const call of calls) {
    if (
      call.status !== "COMPLETED" ||
      !call.committedAt ||
      call.verification === "NONE" ||
      !["APPLIED", "ALREADY_SATISFIED"].includes(call.disposition ?? "")
    )
      continue;
    const removalKind = autoCards
      ? ACTION_RESULT_REMOVAL_KINDS[call.capability]
      : LEGACY_REMOVALS[call.capability];
    if (call.targetId && removalKind)
      removed.add(`${removalKind}\0${call.targetId}`);
    const kind = autoCards
      ? ACTION_RESULT_CARD_KINDS[call.capability]
      : LEGACY_ACTION_RESULTS[call.capability];
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
    const seoTask = ["request_seo_analysis", "create_seo_action_task"].includes(
      call.capability,
    )
      ? z.object({ taskId: z.string() }).safeParse(call.result)
      : null;
    if (seoTask && !seoTask.success) continue;
    const parsed = chatResultReferenceSchema.safeParse({
      kind,
      id: seoTask?.success
        ? seoTask.data.taskId
        : (jobInput?.event.jobId ?? call.targetId),
      ...(kind === "social_post" || kind === "studio_job"
        ? { projectId: project.success ? project.data.projectId : undefined }
        : {}),
    });
    if (parsed.success)
      references.set(actionInputHash(parsed.data), parsed.data);
  }
  // When a turn already showed an item and later removed it, update that
  // existing preview to unavailable; a removal with no prior preview or write
  // still emits no card.
  if (autoCards) {
    for (const [key, { snapshot }] of prepared) {
      const ref = snapshot.reference;
      if ("id" in ref && removed.has(`${ref.kind}\0${ref.id}`)) {
        references.set(key, ref);
      }
    }
  }
  let count = prepared.size;
  for (const [key, reference] of references) {
    const existing = prepared.get(key);
    if (!existing && count >= CHAT_RESULT_PREVIEW_LIMIT) continue;
    const removedKey =
      "id" in reference ? `${reference.kind}\0${reference.id}` : null;
    try {
      // Read after the final action, so create + assignment show one final state.
      // A resource this turn removed is not looked up: that 404 is its card.
      const snapshot =
        removedKey && removed.has(removedKey)
          ? chatResultSnapshotSchema.parse({
              workspaceId: turn.workspaceId,
              reference,
              data: {
                id: existing?.snapshot.data.id ?? randomUUID(),
                state: "unavailable",
                capturedAt: new Date().toISOString(),
                kind: reference.kind,
              },
            })
          : await resolveChatResultReference(
              {
                reference,
                actor: {
                  userId: actingUserId,
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
