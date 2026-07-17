import { createRoute, z } from "@hono/zod-openapi";
import { UI_MESSAGE_STREAM_HEADERS } from "ai";

import { requireConversationCoworkerAccess } from "@/helpers/access-control";
import {
  clearActiveUiStreamIdInMetadata,
  readActiveUiStreamIdFromMetadata,
} from "@/helpers/active-ui-stream-metadata";
import { notFound } from "@/helpers/error";
import { jsonErrorResponse } from "@/helpers/openapi";
import prisma from "@/lib/db/prisma";
import {
  type OpenAPIHonoWithAuth,
  withGlobalHeaderParameters,
} from "@/lib/hono";
import {
  getResumableUiStreamContext,
  isUiStreamResumptionConfigured,
} from "@/lib/resumable-ui-stream-context";
import { forbidOrchestratorActor, requireUserContext } from "@/middleware/auth";

/** `resumable-stream` rejects with this after a fixed ~1s Redis pub/sub handshake timeout. */
function isResumableStreamAckTimeoutError(error: unknown): boolean {
  return error instanceof Error && error.message === "Timeout waiting for ack";
}

const route = createRoute({
  method: "get",
  path: "/stream/{conversationId}",
  description: "Resume an active UI message SSE stream; 204 when none.",
  tags: ["Chat"],
  request: {
    params: z.object({
      conversationId: z
        .string()
        .uuid()
        .openapi({
          param: { name: "conversationId", in: "path" },
          description: "Internal conversation id",
        }),
    }),
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
      description: "No active resumable stream for this conversation",
    },
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Conversation not found"),
    500: jsonErrorResponse("Internal Server Error"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(withGlobalHeaderParameters(route), async (c) => {
    forbidOrchestratorActor(
      c.var.authContext,
      "Orchestrator cannot access marketplace conversations",
    );
    const userContext = requireUserContext(c.var.authContext);
    const { conversationId } = c.req.valid("param");

    const conversation = await prisma.conversation.findFirst({
      where: {
        id: conversationId,
        userId: userContext.userId,
        archivedAt: null,
      },
      select: { id: true, metadata: true },
    });

    if (!conversation) {
      throw notFound("Conversation not found");
    }

    // Per-resource delegation check: a delegated coworker may only resume a
    // stream for a conversation bound to it (no-op for real user sessions).
    await requireConversationCoworkerAccess(
      c.var.authContext,
      conversation.metadata,
    );

    if (!isUiStreamResumptionConfigured()) {
      return new Response(null, { status: 204 });
    }

    const meta = (conversation.metadata ?? {}) as Record<string, unknown>;
    const activeStreamId = readActiveUiStreamIdFromMetadata(meta);
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
      console.warn(
        "Resumable UI stream resume timed out waiting for Redis ack (likely slow Redis or cross-instance latency)",
        { conversationId, activeStreamId },
      );
      void clearActiveUiStreamIdInMetadata({
        conversationId,
        userId: userContext.userId,
      }).catch((clearError) => {
        console.error(
          "Failed to clear active UI stream id after resume ack timeout:",
          clearError,
        );
      });
      return new Response(null, { status: 204 });
    }

    if (resumed == null) {
      void clearActiveUiStreamIdInMetadata({
        conversationId,
        userId: userContext.userId,
      }).catch((error) => {
        console.error(
          "Failed to clear stale active UI stream id after resume miss:",
          error,
        );
      });
      return new Response(null, { status: 204 });
    }

    return new Response(resumed, {
      status: 200,
      headers: UI_MESSAGE_STREAM_HEADERS,
    });
  });
}
