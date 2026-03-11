import { createRoute, z } from "@hono/zod-openapi";

import {
  extractTextFromCompletedOutput,
  getResponseById,
} from "@/clients/coworker-api.client";
import { isResponsesApiConfigured } from "@/config/env";
import { requireCoworkerChatCapability } from "@/helpers/access-control";
import { badRequest, internalServerError, notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import { type OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";

const recoverResponseResultSchema = z
  .object({
    recovered: z.boolean().openapi({
      description: "Whether an in-flight response was recovered and persisted",
    }),
  })
  .openapi("RecoverResponseResult");

const route = createRoute({
  method: "post",
  path: "/{id}/recover-response",
  description:
    "Recover a pending coworker response after client disconnect by fetching it from the Responses API and persisting it",
  tags: ["Conversations"],
  request: {
    params: z.object({
      id: z
        .string()
        .uuid()
        .openapi({
          param: { name: "id", in: "path" },
          description: "Conversation ID",
          example: "550e8400-e29b-41d4-a716-446655440000",
        }),
    }),
  },
  responses: {
    200: jsonSuccessResponse(
      recoverResponseResultSchema,
      "Recovery attempted; recovered is true if a response was persisted",
      { data: { recovered: true } },
    ),
    400: jsonErrorResponse("Bad Request"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Conversation not found"),
    500: jsonErrorResponse("Internal Server Error"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    try {
      const authContext = requireUserAuthContext(c.var.authContext);
      const { id: conversationId } = c.req.valid("param");

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

      const metadata = (conversation.metadata ?? {}) as Record<string, unknown>;
      const pendingResponseId = metadata.pending_responses_api_response_id as
        | string
        | undefined;

      if (!pendingResponseId || typeof pendingResponseId !== "string") {
        return ok(c, { recovered: false });
      }

      if (!isResponsesApiConfigured()) {
        throw badRequest("Responses API is not configured");
      }

      const coworkerSlug = metadata.coworker_slug as string | undefined;
      const coworkerId = metadata.coworker_id as string | undefined;

      let slug: string;
      if (coworkerSlug && typeof coworkerSlug === "string") {
        slug = coworkerSlug;
      } else if (coworkerId && typeof coworkerId === "string") {
        const coworker = await requireCoworkerChatCapability(coworkerId);
        slug = coworker.slug;
      } else {
        throw badRequest(
          "Conversation has no coworker_slug or coworker_id for recovery",
        );
      }

      const result = await getResponseById(pendingResponseId, {
        sokosumiUserId: authContext.userId,
        sokosumiOrganizationId: authContext.organizationId ?? null,
        coworkerSlug: slug,
      });

      if (result.status !== "completed") {
        return ok(c, { recovered: false });
      }

      const text = extractTextFromCompletedOutput(result.output);

      await prisma.$transaction(async (tx) => {
        await tx.conversationItem.create({
          data: {
            conversationId: conversation.id,
            role: "assistant",
            contentType: "output_text",
            contentText: text,
          },
        });

        const currentMeta =
          (conversation.metadata as Record<string, unknown>) ?? {};
        await tx.conversation.update({
          where: { id: conversation.id },
          data: {
            metadata: {
              ...currentMeta,
              last_responses_api_response_id: result.id,
              pending_responses_api_response_id: null,
            },
          },
        });
      });

      return ok(c, { recovered: true });
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
        `Failed to recover response: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  });
}
