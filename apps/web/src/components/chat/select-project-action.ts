"use server";

import { createHash } from "node:crypto";
import { err, ok } from "neverthrow";
import { z } from "zod";
import { sendRoomMessageAction } from "@/app/chat/actions";
import { toActionResult } from "@/lib/actions/action-result";
import { startSokoBotTurnAction } from "@/lib/actions/soko-bot/action";
import { getSession } from "@/lib/auth/auth.server";
import { chatResultPreviewService } from "@/lib/services/chat-result-preview.service";
import { chatRoomService } from "@/lib/services/chat-room.service";
import { sokoBotService } from "@/lib/services/soko-bot.service";
import { userService } from "@/lib/services/user.service";

const sourceSchema = z.union([
  z
    .object({ roomId: z.string().uuid(), messageId: z.string().uuid() })
    .strict(),
  z.object({ turnId: z.string().uuid() }).strict(),
]);
const inputSchema = z
  .object({
    source: sourceSchema,
    previewId: z.string().uuid(),
    projectId: z.string().uuid(),
  })
  .strict();

/** A click is an ordinary user reply, never a generation or publication action. */
export async function selectChatProjectAction(input: unknown) {
  const parsed = inputSchema.safeParse(input);
  const failure = () =>
    toActionResult(err({ message: "Project selection unavailable" }));
  if (!parsed.success) return failure();
  const { source, previewId, projectId } = parsed.data;
  try {
    const session = await getSession();
    if (!session) return failure();
    // A retry or remount of the same choice must never start a second turn.
    const hash = createHash("sha256")
      .update(
        JSON.stringify([
          session.user.id,
          "turnId" in source
            ? ["turn", source.turnId]
            : ["room", source.roomId, source.messageId],
          previewId,
          projectId,
        ]),
      )
      .digest("hex");
    const clientMessageId = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
    // Rehydrate through Core before sending. Browser labels and stale options
    // cannot inject a different project or reveal one whose access was revoked.
    const results =
      "turnId" in source
        ? await chatResultPreviewService.forTurn(source.turnId)
        : await chatResultPreviewService.forMessage(
            source.roomId,
            source.messageId,
          );
    const selector = results.find((result) => result.id === previewId);
    const project =
      selector?.state === "available" && selector.kind === "project_selection"
        ? selector.projectOptions?.find((option) => option.id === projectId)
        : null;
    if (!project) return failure();
    const content = `Use project ${JSON.stringify(project.name)} (project ID: ${project.id}).`;
    if ("turnId" in source) {
      const turn = await sokoBotService.getTurn(source.turnId);
      const workspaces = await userService.getMyWorkspaces();
      const current = workspaces?.workspaces.find(
        (workspace) =>
          workspace.organizationId ===
          (session.session.activeOrganizationId ?? null),
      );
      if (!current || current.id !== turn.workspaceId) return failure();
      const message = `Continue this request: ${JSON.stringify(turn.userMessage.slice(0, 2000))}\nYour question: ${JSON.stringify((turn.finalAnswer ?? "").slice(0, 2000))}\n${content}`;
      const result = await startSokoBotTurnAction({
        input: { clientTurnId: clientMessageId, message },
      });
      return result.ok ? toActionResult(ok(null)) : failure();
    }
    const message = await chatRoomService.getMessage(
      source.roomId,
      source.messageId,
    );
    if (!message || message.sender.type !== "sokoBot") return failure();
    const result = await sendRoomMessageAction(source.roomId, content, [], {
      quote: { messageId: source.messageId },
      mentionedSokoBotIds: [message.sender.sokoBot.id],
      parentMessageId: message.parentMessageId ?? undefined,
      clientMessageId,
    });
    return result.ok ? toActionResult(ok(null)) : failure();
  } catch {
    return failure();
  }
}
