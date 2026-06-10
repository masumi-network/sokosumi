import { createRoute, z } from "@hono/zod-openapi";
import { userRepository } from "@sokosumi/database/repositories";

import {
  buildUserDesignMdMetadataUpdate,
  readUserDesignMdMetadata,
} from "@/helpers/design-md-metadata";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { empty, ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { usersRoutePathUserIdSchema } from "@/routes/v1/users/user-path-access";
import {
  requireUserRouteContext,
  type UserRouteVariables,
} from "@/routes/v1/users/user-route-context";
import {
  designMdMetadataSchema,
  designMdUpdateRequestSchema,
} from "@/schemas/design-md.schema";

const params = z.object({
  id: usersRoutePathUserIdSchema,
});

const getRoute = createRoute({
  method: "get",
  path: "/design-md",
  description: "Read DESIGN.md metadata stored on the user profile.",
  tags: ["Users"],
  request: { params },
  responses: {
    200: jsonSuccessResponse(
      designMdMetadataSchema,
      "Retrieve user DESIGN.md metadata",
      {
        data: {
          extractionId: "42",
          previewUrl: "https://www.masumi.network/tools/design-md?cached=42",
          url: "https://blob.example/design-md/file.md",
        },
        meta: {
          timestamp: "2025-01-01T00:00:00.000Z",
          requestId: "550e8400-e29b-41d4-a716-446655440000",
        },
      },
    ),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
  },
});

const patchRoute = createRoute({
  method: "patch",
  path: "/design-md",
  description: "Update DESIGN.md metadata on the user profile.",
  tags: ["Users"],
  request: {
    params,
    body: {
      content: {
        "application/json": {
          schema: designMdUpdateRequestSchema,
        },
      },
    },
  },
  responses: {
    200: jsonSuccessResponse(
      designMdMetadataSchema,
      "Updated user DESIGN.md metadata",
      {
        data: {
          extractionId: null,
          previewUrl: null,
          url: "https://blob.example/design-md/file.md",
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
  },
});

const deleteRoute = createRoute({
  method: "delete",
  path: "/design-md",
  description: "Remove DESIGN.md metadata from the user profile.",
  tags: ["Users"],
  request: { params },
  responses: {
    204: {
      description: "DESIGN.md metadata removed",
    },
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth<UserRouteVariables>) {
  app.openapi(getRoute, async (c) => {
    c.req.valid("param");
    const { resolvedUserId } = requireUserRouteContext(c.var.userRouteContext);

    const user = await userRepository.getUserById(resolvedUserId, prisma);
    const metadata = readUserDesignMdMetadata(user?.metadata);

    return ok(c, designMdMetadataSchema.parse(metadata));
  });

  app.openapi(patchRoute, async (c) => {
    c.req.valid("param");
    const { resolvedUserId } = requireUserRouteContext(c.var.userRouteContext);
    const body = c.req.valid("json");

    const updated = await prisma.$transaction(async (tx) => {
      const user = await userRepository.getUserById(resolvedUserId, tx);
      if (!user) {
        return null;
      }

      const serializedMetadata = buildUserDesignMdMetadataUpdate(
        user.metadata,
        {
          extractionId: body.extractionId,
          url: body.url,
        },
      );

      await userRepository.updateUserMetadata(
        resolvedUserId,
        serializedMetadata,
        tx,
      );

      return readUserDesignMdMetadata(serializedMetadata);
    });

    return ok(c, designMdMetadataSchema.parse(updated));
  });

  app.openapi(deleteRoute, async (c) => {
    c.req.valid("param");
    const { resolvedUserId } = requireUserRouteContext(c.var.userRouteContext);

    await prisma.$transaction(async (tx) => {
      const user = await userRepository.getUserById(resolvedUserId, tx);
      if (!user) {
        return;
      }

      const serializedMetadata = buildUserDesignMdMetadataUpdate(
        user.metadata,
        {
          extractionId: null,
          url: null,
        },
      );

      await userRepository.updateUserMetadata(
        resolvedUserId,
        serializedMetadata,
        tx,
      );
    });

    return empty(c);
  });
}
