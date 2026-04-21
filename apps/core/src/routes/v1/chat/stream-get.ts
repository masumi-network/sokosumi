import { createRoute, z } from "@hono/zod-openapi";
import { UI_MESSAGE_STREAM_HEADERS } from "ai";

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
import { requireUserAuthContext } from "@/middleware/auth";

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
    const authContext = requireUserAuthContext(c.var.authContext);
    const { conversationId } = c.req.valid("param");

    const conversation = await prisma.conversation.findFirst({
      where: {
        id: conversationId,
        userId: authContext.userId,
        archivedAt: null,
      },
      select: { id: true, metadata: true },
    });

    if (!conversation) {
      throw notFound("Conversation not found");
    }

    if (!isUiStreamResumptionConfigured()) {
      return new Response(null, { status: 204 });
    }

    const meta = (conversation.metadata ?? {}) as Record<string, unknown>;
    const activeStreamId = readActiveUiStreamIdFromMetadata(meta);
    if (!activeStreamId) {
      return new Response(null, { status: 204 });
    }

    const ctx = getResumableUiStreamContext();
    const resumed = await ctx.resumeExistingStream(activeStreamId);
    if (resumed == null) {
      void clearActiveUiStreamIdInMetadata({
        conversationId,
        userId: authContext.userId,
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
