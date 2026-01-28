import { createRoute, z } from "@hono/zod-openapi";
import {
  conversationItemRepository,
  conversationRepository,
} from "@sokosumi/database/repositories";

import { notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { created } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import {
  type OpenAPIHonoWithAuth,
  withGlobalHeaderParameters,
} from "@/lib/hono";

const conversationItemSchema = z
  .object({
    id: z.string().openapi({
      description: "Conversation item ID",
      example: "item_abc123",
    }),
    role: z
      .enum(["user", "assistant", "system"])
      .openapi({ description: "Item role" }),
    content: z
      .union([
        z.string(),
        z.array(
          z.object({
            type: z.string(),
            text: z.string().optional(),
          }),
        ),
      ])
      .openapi({ description: "Item content" }),
    status: z.string().openapi({ description: "Item status" }),
    created_at: z.number().openapi({ description: "Unix timestamp" }),
  })
  .openapi("ConversationItem");

const createConversationItemRequestSchema = z
  .object({
    role: z.enum(["user", "assistant", "system"]).openapi({
      description: "Item role",
    }),
    content: z
      .union([
        z.string(),
        z.array(
          z.object({
            type: z.string(),
            text: z.string().optional(),
          }),
        ),
      ])
      .openapi({ description: "Item content" }),
  })
  .openapi("CreateConversationItemRequest");

const route = withGlobalHeaderParameters(
  createRoute({
    method: "post",
    path: "/{id}/items",
    description: "Add an item to a conversation",
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
      body: {
        content: {
          "application/json": {
            schema: createConversationItemRequestSchema,
          },
        },
      },
    },
    responses: {
      201: jsonSuccessResponse(
        conversationItemSchema,
        "Conversation item created successfully",
        {
          data: {
            id: "item_abc123",
            role: "user",
            content: "Hello!",
            status: "completed",
            created_at: 1706284800,
          },
          meta: {
            timestamp: "2025-01-21T12:00:00.000Z",
            requestId: "550e8400-e29b-41d4-a716-446655440000",
          },
        },
      ),
      401: jsonErrorResponse("Unauthorized"),
      404: jsonErrorResponse("Conversation not found"),
      500: jsonErrorResponse("Internal Server Error"),
    },
  }),
);

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { authContext } = c.var;
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");

    // Database is the source of truth - validate ownership and create item
    const conversation = await conversationRepository.getConversationById(
      id,
      authContext.userId,
      prisma,
    );

    if (!conversation) {
      throw notFound("Conversation not found");
    }

    // Create conversation item in database
    const item = await conversationItemRepository.createItem(
      {
        conversationId: conversation.id,
        role: body.role,
        content: body.content,
      },
      prisma,
    );

    // Update conversation updatedAt timestamp
    await conversationRepository.updateConversation(
      id,
      authContext.userId,
      {},
      prisma,
    );

    // Map to response schema
    const response = {
      id: item.id,
      role: item.role as "user" | "assistant" | "system",
      content: item.content as string | Array<{ type: string; text?: string }>,
      status: "completed",
      created_at: Math.floor(item.createdAt.getTime() / 1000),
    };

    return created(c, response);
  });
}
