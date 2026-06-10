import { createRoute, z } from "@hono/zod-openapi";
import { userRepository } from "@sokosumi/database/repositories";

import { buildUserDesignMdMetadata } from "@/helpers/design-md";
import { notFound, serviceUnavailable } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import { uploadDesignMdContent } from "@/lib/design-md-blob";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { usersRoutePathUserIdSchema } from "@/routes/v1/users/user-path-access";
import {
  requireUserRouteContext,
  type UserRouteVariables,
} from "@/routes/v1/users/user-route-context";
import {
  designMdWriteSchema,
  persistedDesignMdSchema,
} from "@/schemas/design-md.schema";

const params = z.object({
  id: usersRoutePathUserIdSchema,
});

const route = createRoute({
  method: "put",
  path: "/design-md",
  description:
    "Set or clear the user's own DESIGN.md (path `me` or a user id when the caller may access that user's data). Pass a null `url` to clear it.",
  tags: ["Users"],
  request: {
    params,
    body: {
      content: {
        "application/json": {
          schema: designMdWriteSchema,
        },
      },
    },
  },
  responses: {
    200: jsonSuccessResponse(
      persistedDesignMdSchema,
      "The persisted DESIGN.md for the user",
      {
        data: {
          designMd: {
            url: "https://blob.example/design.md",
            extractionId: "12345",
          },
        },
        meta: {
          timestamp: "2025-01-01T00:00:00.000Z",
          requestId: "550e8400-e29b-41d4-a716-446655440000",
        },
      },
    ),
    400: jsonErrorResponse("Bad Request"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
    500: jsonErrorResponse("Internal Server Error"),
    503: jsonErrorResponse("Service Unavailable - DESIGN.md storage failed"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth<UserRouteVariables>) {
  app.openapi(route, async (c) => {
    c.req.valid("param");
    const { resolvedUserId } = requireUserRouteContext(c.var.userRouteContext);
    const body = c.req.valid("json");

    const user = await userRepository.getUserById(resolvedUserId, prisma);
    if (!user) {
      throw notFound("User not found");
    }

    let url: string | null = null;
    if (body.content !== null) {
      url = await uploadDesignMdContent(body.content, body.extractionId);
      if (!url) {
        throw serviceUnavailable("Failed to store the DESIGN.md");
      }
    }

    const { serialized, persisted } = buildUserDesignMdMetadata(user.metadata, {
      url,
      extractionId: body.extractionId,
    });

    await userRepository.updateUserMetadata(resolvedUserId, serialized, prisma);

    return ok(c, persistedDesignMdSchema.parse({ designMd: persisted }));
  });
}
