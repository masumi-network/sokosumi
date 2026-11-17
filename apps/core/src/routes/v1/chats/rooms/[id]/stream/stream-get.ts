import { createRoute, z } from "@hono/zod-openapi";
import { UI_MESSAGE_STREAM_HEADERS } from "ai";

import {
  clearActiveUiStreamIdForRoom,
  readActiveUiStreamIdForRoom,
} from "@/helpers/active-ui-stream-room-metadata";
import { jsonErrorResponse } from "@/helpers/openapi";
import prisma from "@/lib/db/prisma";
import {
  emitCoreError,
  recordCoreWarning,
  runAsBackgroundWork,
} from "@/lib/evlog";
import {
  type OpenAPIHonoWithAuth,
  withOrganizationSlugHeaderParameter,
} from "@/lib/hono";
import {
  getResumableUiStreamContext,
  isUiStreamResumptionConfigured,
} from "@/lib/resumable-ui-stream-context";
import { messageSafeErrorFields } from "@/lib/safe-error-fields";
import { requireUserAuthContext } from "@/middleware/auth";

import { requireChatRoomUserMembership } from "../../helpers";

/** `resumable-stream` rejects with this after a fixed ~1s Redis pub/sub handshake timeout. */
function isResumableStreamAckTimeoutError(error: unknown): boolean {
  return error instanceof Error && error.message === "Timeout waiting for ack";
}

const paramsSchema = z.object({
  id: z
    .string()
    .uuid()
    .openapi({
      param: { name: "id", in: "path" },
      example: "550e8400-e29b-41d4-a716-446655440000",
    }),
});

const route = withOrganizationSlugHeaderParameter(
  createRoute({
    method: "get",
    path: "/{id}/stream/active",
    description:
      "Resume an active UI message SSE stream for a chat room; 204 when none.",
    tags: ["Chat Rooms"],
    request: {
      params: paramsSchema,
    },
    responses: {
      200: {
        description: "Resumable UI message stream (SSE)",
        content: {
          "text/event-stream": {
            schema: z.string(),
          },
        },
      },
      204: {
        description: "No active resumable stream for this room",
      },
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("Room not found"),
      500: jsonErrorResponse("Internal Server Error"),
    },
  }),
);

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const userContext = requireUserAuthContext(c.var.authContext);
    const { id: roomId } = c.req.valid("param");

    await requireChatRoomUserMembership(roomId, userContext.userId, prisma);

    if (!isUiStreamResumptionConfigured()) {
      return new Response(null, { status: 204 });
    }

    const activeStreamId = await readActiveUiStreamIdForRoom(roomId);
    if (!activeStreamId) {
      return new Response(null, { status: 204 });
    }

    const ctx = getResumableUiStreamContext();
    let resumed;
    try {
      resumed = await ctx.resumeExistingStream(activeStreamId);
    } catch (error) {
      if (!isResumableStreamAckTimeoutError(error)) {
        throw error;
      }
      recordCoreWarning(
        { operation: "chat_room_stream_resume", roomId, activeStreamId },
        {
          message: "Could not resume a chat room's live stream",
          why: "Redis did not acknowledge the resume in time",
          fix: "The client falls back to the saved messages. If it repeats, check the Redis instance's latency.",
        },
        // The resume carries the reply's stream: content-free fields only.
        { failure: messageSafeErrorFields(error) },
      );
      clearStaleStreamIdAfterResponse(
        { roomId, userId: userContext.userId },
        "resume_ack_timeout",
      );
      return new Response(null, { status: 204 });
    }

    if (resumed == null) {
      clearStaleStreamIdAfterResponse(
        { roomId, userId: userContext.userId },
        "resume_miss",
      );
      return new Response(null, { status: 204 });
    }

    return new Response(resumed, {
      status: 200,
      headers: UI_MESSAGE_STREAM_HEADERS,
    });
  });
}

/**
 * Clears the room's stale stream id without holding the response; a failure
 * is its own event, since the request's event may be emitted by then.
 */
function clearStaleStreamIdAfterResponse(
  params: { roomId: string; userId: string },
  staleBecause: "resume_ack_timeout" | "resume_miss",
): void {
  void runAsBackgroundWork(() => clearActiveUiStreamIdForRoom(params)).catch(
    (error) => {
      emitCoreError(
        {
          operation: "chat_room_stream_resume",
          roomId: params.roomId,
          staleBecause,
        },
        {
          message: "Could not clear a chat room's stale stream id",
          why: "Writing the room's stream metadata failed",
          fix: "The next resume attempt misses again and retries the clear. If it repeats, check the database.",
        },
        // The room's stream metadata sits next to the reply's stream:
        // content-free fields only.
        { failure: messageSafeErrorFields(error) },
      );
    },
  );
}
