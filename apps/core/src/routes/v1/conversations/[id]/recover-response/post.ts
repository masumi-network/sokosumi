import { createRoute, z } from "@hono/zod-openapi";
import { requireCoworkerChatCapability } from "@/helpers/access-control";
import { findCoworkerWithChatBySlug } from "@/helpers/coworker-queries";
import { badRequest, internalServerError, notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import { type OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import {
  extractLatestAssistantFromConversationItems,
  extractTextFromCompletedOutput,
  getResponseById,
  listCoworkerConversationItems,
} from "./coworker-recovery";

const recoverResponseResultSchema = z
  .object({
    recovered: z.boolean().openapi({
      description: "True if a completed response was fetched and saved",
    }),
    reason: z
      .enum(["not_found", "in_progress", "terminal"])
      .optional()
      .openapi({
        description: "When recovered is false",
      }),
  })
  .openapi("RecoverResponseResult");

const route = createRoute({
  method: "post",
  path: "/{id}/recover-response",
  description:
    "Fetch pending coworker Responses API result and persist if complete",
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
    200: jsonSuccessResponse(recoverResponseResultSchema, "Recovery result", {
      data: { recovered: true },
    }),
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
        select: { id: true, metadata: true, providerConversationId: true },
      });

      if (!conversation) {
        throw notFound("Conversation not found");
      }

      const metadata = (conversation.metadata ?? {}) as Record<string, unknown>;
      const pendingResponseId = metadata.pending_responses_api_response_id as
        | string
        | undefined;

      const resolveCoworkerFromMetadata = async (): Promise<{
        id: string;
        slug: string;
        baseURL: string | null;
        supportsConversationsApi: boolean;
      }> => {
        const coworkerSlug = metadata.coworker_slug as string | undefined;
        const coworkerId = metadata.coworker_id as string | undefined;
        if (coworkerId && typeof coworkerId === "string") {
          return await requireCoworkerChatCapability(coworkerId);
        }
        if (coworkerSlug && typeof coworkerSlug === "string") {
          const bySlug = await findCoworkerWithChatBySlug(coworkerSlug);
          if (!bySlug) {
            throw badRequest(
              "No coworker with chat and base URL found for slug",
            );
          }
          return bySlug;
        }
        throw badRequest(
          "Conversation has no coworker_slug or coworker_id for recovery",
        );
      };

      if (pendingResponseId && typeof pendingResponseId === "string") {
        const coworker = await resolveCoworkerFromMetadata();

        if (!coworker.baseURL?.trim()) {
          throw badRequest("Coworker has no Responses API base URL");
        }

        const result = await getResponseById(pendingResponseId, {
          responsesApiBaseUrl: coworker.baseURL.trim(),
          sokosumiUserId: authContext.userId,
          sokosumiOrganizationId: authContext.organizationId ?? null,
          coworkerSlug: coworker.slug,
        });

        if (result.status !== "completed") {
          const reason =
            result.status === "not_found"
              ? ("not_found" as const)
              : result.status === "terminal"
                ? ("terminal" as const)
                : ("in_progress" as const);
          if (result.status === "not_found" || result.status === "terminal") {
            await prisma.$executeRaw`
            UPDATE conversation
            SET metadata = metadata - 'pending_responses_api_response_id'
            WHERE id = ${conversationId}
              AND "userId" = ${authContext.userId}
              AND "archivedAt" IS NULL
              AND (metadata->>'pending_responses_api_response_id') = ${pendingResponseId}
          `;
          }
          return ok(c, { recovered: false, reason });
        }

        const text = extractTextFromCompletedOutput(result.output);

        const currentMeta =
          (conversation.metadata as Record<string, unknown>) ?? {};
        const newMetadata = {
          ...currentMeta,
          pending_responses_api_response_id: null,
          previous_response_id: result.id,
        };

        let didRecover = false;
        await prisma.$transaction(async (tx) => {
          await tx.$executeRaw`
          SELECT pg_advisory_xact_lock(hashtext(${pendingResponseId})::bigint)
        `;
          await tx.$queryRaw`
          SELECT id FROM conversation
          WHERE id = ${conversationId}
          FOR UPDATE
        `;
          const rowsUpdated = await tx.$executeRaw`
          UPDATE conversation
          SET metadata = metadata - 'pending_responses_api_response_id'
          WHERE id = ${conversationId}
            AND (metadata->>'pending_responses_api_response_id') = ${pendingResponseId}
        `;
          if (rowsUpdated === 0) {
            return;
          }
          const existing = await tx.conversationMessage.findFirst({
            where: {
              conversationId: conversation.id,
              responsesApiResponseId: result.id,
            },
          });
          if (!existing) {
            await tx.conversationMessage.create({
              data: {
                conversationId: conversation.id,
                role: "assistant",
                contentType: "output_text",
                contentText: text,
                responsesApiResponseId: result.id,
              },
            });
          }
          await tx.conversation.update({
            where: { id: conversation.id },
            data: { metadata: newMetadata },
          });
          didRecover = true;
        });

        if (!didRecover) {
          return ok(c, { recovered: false, reason: "in_progress" });
        }
        return ok(c, { recovered: true });
      }

      const providerConvId = conversation.providerConversationId;
      if (!providerConvId || typeof providerConvId !== "string") {
        return ok(c, { recovered: false });
      }

      const coworkerForItems = await resolveCoworkerFromMetadata();
      if (!coworkerForItems.supportsConversationsApi) {
        return ok(c, { recovered: false });
      }
      if (!coworkerForItems.baseURL?.trim()) {
        throw badRequest("Coworker has no Responses API base URL");
      }

      const listed = await listCoworkerConversationItems(providerConvId, {
        responsesApiBaseUrl: coworkerForItems.baseURL.trim(),
        sokosumiUserId: authContext.userId,
        sokosumiOrganizationId: authContext.organizationId ?? null,
        coworkerSlug: coworkerForItems.slug,
      });
      const extracted = extractLatestAssistantFromConversationItems(
        listed.items,
      );
      if (!extracted.text.trim()) {
        return ok(c, { recovered: false, reason: "not_found" });
      }

      const text = extracted.text;
      const responseIdForPersist = extracted.responseId;

      const currentMeta =
        (conversation.metadata as Record<string, unknown>) ?? {};
      const newMetadata = {
        ...currentMeta,
        ...(responseIdForPersist
          ? { previous_response_id: responseIdForPersist }
          : {}),
      };

      let didRecoverItems = false;
      await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`
          SELECT id FROM conversation
          WHERE id = ${conversationId}
          FOR UPDATE
        `;
        if (responseIdForPersist) {
          const existing = await tx.conversationMessage.findFirst({
            where: {
              conversationId: conversation.id,
              responsesApiResponseId: responseIdForPersist,
            },
          });
          if (existing) {
            await tx.conversation.update({
              where: { id: conversation.id },
              data: { metadata: newMetadata },
            });
            didRecoverItems = true;
            return;
          }
        }
        await tx.conversationMessage.create({
          data: {
            conversationId: conversation.id,
            role: "assistant",
            contentType: "output_text",
            contentText: text,
            responsesApiResponseId: responseIdForPersist ?? undefined,
          },
        });
        await tx.conversation.update({
          where: { id: conversation.id },
          data: { metadata: newMetadata },
        });
        didRecoverItems = true;
      });

      if (!didRecoverItems) {
        return ok(c, { recovered: false, reason: "in_progress" });
      }
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
