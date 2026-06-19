import { createRoute } from "@hono/zod-openapi";
import { userRepository } from "@sokosumi/database/repositories";

import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import {
  adminSearchQuerySchema,
  adminUserSearchResponseSchema,
} from "@/schemas/admin.schema";

const SEARCH_LIMIT = 20;

const route = createRoute({
  method: "get",
  path: "/users",
  operationId: "searchAdminUsers",
  description: "Search users by name or email (admin only).",
  tags: ["Admin"],
  request: {
    query: adminSearchQuerySchema,
  },
  responses: {
    200: jsonSuccessResponse(
      adminUserSearchResponseSchema,
      "Users matching the search query",
      {
        data: [
          { id: "user_123", name: "Ada Lovelace", email: "ada@example.com" },
        ],
        meta: {
          timestamp: "2025-01-01T00:00:00.000Z",
          requestId: "550e8400-e29b-41d4-a716-446655440000",
        },
      },
    ),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { query } = c.req.valid("query");

    const users = await userRepository.searchUsers(
      query ?? "",
      SEARCH_LIMIT,
      prisma,
    );

    const options = users.map((user) => ({
      id: user.id,
      name: user.name,
      email: user.email,
    }));

    return ok(c, adminUserSearchResponseSchema.parse(options));
  });
}
