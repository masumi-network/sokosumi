import { createRoute, z } from "@hono/zod-openapi";

import { internalServerError, notFound } from "@/helpers/error";
import { jsonErrorResponse } from "@/helpers/openapi";
import { empty } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import { type OpenAPIHonoWithAuth } from "@/lib/hono";

const route = createRoute({
  method: "delete",
  path: "/{id}",
  description:
    "Archive a conversation mapping (sets archivedAt timestamp, can be recovered)",
  tags: ["Conversations"],
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
    204: {
      description: "Conversation deleted successfully",
    },
    401: jsonErrorResponse("Unauthorized"),
    404: jsonErrorResponse("Conversation not found"),
    500: jsonErrorResponse("Internal Server Error"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    try {
      const { authContext } = c.var;
      const { id } = c.req.valid("param");

      // Database is the source of truth - validate ownership and archive in DB
      await prisma.$transaction(async (tx) => {
        // Include archived conversations so we can re-archive already archived ones
        const existing = await tx.conversation.findFirst({
          where: { id, userId: authContext.userId },
        });

        if (!existing) {
          throw notFound("Conversation not found");
        }

        // Archive conversation in database (sets archivedAt timestamp)
        // This will set archivedAt even if it's already set (idempotent operation)
        await tx.conversation.update({
          where: { id },
          data: { archivedAt: new Date() },
        });
      });

      return empty(c);
    } catch (error) {
      // Re-throw HTTPException as-is, wrap other errors
      if (
        error &&
        typeof error === "object" &&
        "status" in error &&
        "message" in error
      ) {
        throw error;
      }
      throw internalServerError(
        `Failed to delete conversation: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  });
}
