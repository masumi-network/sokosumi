import { createRoute } from "@hono/zod-openapi";
import { waitUntil } from "@vercel/functions";
import { v4 as uuidv4 } from "uuid";
import {
  pinCoworkerConversationBinding,
  requireCoworkerChatCapability,
} from "@/helpers/access-control";
import { conflict, internalServerError } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { created } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import {
  type OpenAPIHonoWithAuth,
  withGlobalHeaderParameters,
} from "@/lib/hono";
import { requireOwnerUserContext } from "@/middleware/auth";
import { ensureCoworkerProviderConversation } from "@/routes/v1/chats/stream/coworker-conversation";
import { warmupCoworkerConversation } from "@/routes/v1/chats/stream/warmup-coworker";
import {
  conversationSchema,
  createConversationRequestSchema,
} from "@/schemas/conversation.schema";

const route = withGlobalHeaderParameters(
  createRoute({
    method: "post",
    path: "/",
    description: "Create a new conversation mapping",
    tags: ["Conversations"],
    deprecated: true,
    request: {
      body: {
        content: {
          "application/json": {
            schema: createConversationRequestSchema,
          },
        },
      },
    },
    responses: {
      201: jsonSuccessResponse(
        conversationSchema,
        "Conversation created successfully",
        {
          data: {
            id: "550e8400-e29b-41d4-a716-446655440000",
            userId: "550e8400-e29b-41d4-a716-446655440000",
            title: "Chat with Hannah",
            metadata: { coworker: "Hannah" },
            createdAt: "2025-01-21T12:00:00.000Z",
            updatedAt: "2025-01-21T12:00:00.000Z",
          },
          meta: {
            timestamp: "2025-01-21T12:00:00.000Z",
            requestId: "550e8400-e29b-41d4-a716-446655440000",
          },
        },
      ),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      409: jsonErrorResponse("Conversation already exists"),
      500: jsonErrorResponse("Internal Server Error"),
    },
  }),
);

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    try {
      const userContext = requireOwnerUserContext(c.var.authContext);
      const body = c.req.valid("json");

      // Database is the source of truth - create conversation directly in DB
      // Use provided openaiId or generate a new one
      const openaiId = body.openaiId || uuidv4();

      const conversation = await prisma.$transaction(async (tx) => {
        // Check if conversation with this ID already exists (shouldn't happen with UUID, but safety check)
        const existing = await tx.conversation.findFirst({
          where: {
            openaiId,
            userId: userContext.userId,
            archivedAt: null,
          },
        });

        if (existing) {
          throw conflict("Conversation already exists");
        }

        // A delegated coworker owns the conversations it creates: pin the
        // binding so later per-resource checks recognize it (no-op for users).
        const metadata = pinCoworkerConversationBinding(c.var.authContext, {
          ...(body.metadata ?? {}),
          userId: userContext.userId, // Store userId in metadata for reference
        });

        // Create conversation in database with title and metadata
        const conversationData = {
          openaiId,
          userId: userContext.userId,
          title: body.title,
          metadata,
        };

        return tx.conversation.create({ data: conversationData });
      });

      const conversationMetadata =
        (conversation.metadata as Record<string, unknown> | null) ?? null;
      const coworkerSlug = conversationMetadata?.coworker_slug as
        | string
        | undefined;
      const coworkerId = conversationMetadata?.coworker_id as
        | string
        | undefined;
      const isCoworkerChat =
        conversationMetadata?.type === "coworker" ||
        Boolean(coworkerSlug || coworkerId);

      if (isCoworkerChat && (coworkerSlug || coworkerId)) {
        try {
          const coworkerIdentity = await prisma.coworker.findFirst({
            where: {
              archivedAt: null,
              ...(coworkerId ? { id: coworkerId } : { slug: coworkerSlug }),
            },
            select: { id: true },
          });
          if (coworkerIdentity) {
            const coworker = await requireCoworkerChatCapability(
              coworkerIdentity.id,
            );
            if (coworker.baseURL?.trim()) {
              const responsesApiBaseUrl = coworker.baseURL.trim();
              await ensureCoworkerProviderConversation({
                internalConversationId: conversation.id,
                userId: userContext.userId,
                organizationId: userContext.organizationId ?? null,
                coworkerSlug: coworker.slug,
                responsesApiBaseUrl,
              });
              waitUntil(
                warmupCoworkerConversation({
                  internalConversationId: conversation.id,
                  userId: userContext.userId,
                  organizationId: userContext.organizationId ?? null,
                  coworkerSlug: coworker.slug,
                  responsesApiBaseUrl,
                }),
              );
            }
          }
        } catch (error) {
          console.error(
            "Failed to eagerly create coworker provider conversation; will retry on first message:",
            error,
          );
        }
      }

      // Map to response schema
      const response = {
        id: conversation.id,
        userId: conversation.userId,
        title: conversation.title,
        metadata:
          (conversation.metadata as Record<string, unknown> | null) || null,
        createdAt: conversation.createdAt,
        updatedAt: conversation.updatedAt,
      };

      return created(c, conversationSchema.parse(response));
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
        `Failed to create conversation: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  });
}
