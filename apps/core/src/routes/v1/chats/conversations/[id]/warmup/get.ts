import { createRoute, z } from "@hono/zod-openapi";

import {
  requireConversationCoworkerAccess,
  resolveConversationCoworkerId,
} from "@/helpers/access-control";
import { internalServerError, notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import {
  type OpenAPIHonoWithAuth,
  withGlobalHeaderParameters,
} from "@/lib/hono";
import { requireUserContext } from "@/middleware/auth";
import { readCoworkerReadyState } from "@/routes/v1/chats/stream/warmup-coworker";
import { conversationWarmupStateSchema } from "@/schemas/conversation.schema";

const route = withGlobalHeaderParameters(
  createRoute({
    method: "get",
    path: "/{id}/warmup",
    description: "Get coworker container warmup state for a conversation",
    tags: ["Conversations"],
    deprecated: true,
    request: {
      params: z.object({
        id: z
          .string()
          .uuid()
          .openapi({
            param: {
              name: "id",
              in: "path",
            },
            description: "Internal database ID",
            example: "550e8400-e29b-41d4-a716-446655440000",
          }),
      }),
    },
    responses: {
      200: jsonSuccessResponse(
        conversationWarmupStateSchema,
        "Warmup state retrieved successfully",
        {
          data: {
            conversationId: "550e8400-e29b-41d4-a716-446655440000",
            state: "ready",
            completedAt: "2025-01-21T12:00:00.000Z",
            source: "redis",
          },
          meta: {
            timestamp: "2025-01-21T12:00:00.000Z",
            requestId: "550e8400-e29b-41d4-a716-446655440000",
          },
        },
      ),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("Conversation not found"),
      500: jsonErrorResponse("Internal Server Error"),
    },
  }),
);

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    try {
      const userContext = requireUserContext(c.var.authContext);
      const { id } = c.req.valid("param");

      const conversation = await prisma.$transaction(async (tx) => {
        const found = await tx.conversation.findFirst({
          where: {
            id,
            userId: userContext.userId,
            archivedAt: null,
          },
        });

        if (!found) {
          throw notFound("Conversation not found");
        }

        const conversationCoworkerId = await resolveConversationCoworkerId(
          found.metadata,
          tx,
        );
        if (!conversationCoworkerId) {
          throw notFound("Conversation not found");
        }

        await requireConversationCoworkerAccess(
          c.var.authContext,
          found.metadata,
          tx,
        );

        return found;
      });

      const metadata =
        (conversation.metadata as Record<string, unknown> | null) ?? null;
      const readyState = await readCoworkerReadyState(id, metadata);
      const state = readyState.state === "unknown" ? "ready" : readyState.state;

      return ok(
        c,
        conversationWarmupStateSchema.parse({
          conversationId: id,
          state,
          completedAt: readyState.completedAt,
          attempts: readyState.attempts,
          source: readyState.source,
        }),
      );
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        "status" in error &&
        "message" in error
      ) {
        throw error;
      }
      throw internalServerError(
        `Failed to retrieve conversation warmup state: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  });
}
