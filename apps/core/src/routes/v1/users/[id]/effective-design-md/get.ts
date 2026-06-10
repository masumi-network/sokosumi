import { createRoute, z } from "@hono/zod-openapi";
import {
  memberRepository,
  organizationRepository,
  userRepository,
} from "@sokosumi/database/repositories";
import { getOrganizationMetadata, getUserMetadata } from "@sokosumi/utils";

import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { usersRoutePathUserIdSchema } from "@/routes/v1/users/user-path-access";
import {
  requireUserRouteContext,
  type UserRouteVariables,
} from "@/routes/v1/users/user-route-context";
import { effectiveDesignMdSchema } from "@/schemas/design-md.schema";

const DESIGN_MD_ATTACHMENT_LABEL = "DESIGN.md";

const params = z.object({
  id: usersRoutePathUserIdSchema,
});

const querySchema = z.object({
  organizationId: z
    .string()
    .optional()
    .openapi({
      param: { name: "organizationId", in: "query" },
      description:
        "When provided and the user is a member, the organization's DESIGN.md takes precedence over the user's own.",
      example: "org_123",
    }),
});

const route = createRoute({
  method: "get",
  path: "/effective-design-md",
  description:
    "Resolve the DESIGN.md attachment currently in effect for the user (`me` or a user id). When `organizationId` is supplied and the user is a member, the organization's DESIGN.md is preferred over the user's own; otherwise the user's own DESIGN.md (or null) is returned.",
  tags: ["Users"],
  request: {
    params,
    query: querySchema,
  },
  responses: {
    200: jsonSuccessResponse(
      effectiveDesignMdSchema,
      "The effective DESIGN.md for the user",
      {
        data: {
          designMd: {
            label: DESIGN_MD_ATTACHMENT_LABEL,
            url: "https://blob.example/design.md",
          },
        },
        meta: {
          timestamp: "2025-01-01T00:00:00.000Z",
          requestId: "550e8400-e29b-41d4-a716-446655440000",
        },
      },
    ),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    500: jsonErrorResponse("Internal Server Error"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth<UserRouteVariables>) {
  app.openapi(route, async (c) => {
    const { organizationId } = c.req.valid("query");
    const { resolvedUserId } = requireUserRouteContext(c.var.userRouteContext);

    if (organizationId) {
      const member = await memberRepository.getMemberByUserIdAndOrganizationId(
        resolvedUserId,
        organizationId,
        prisma,
      );

      if (member) {
        const organization =
          await organizationRepository.getOrganizationWithRelationsById(
            organizationId,
            prisma,
          );
        const organizationDesignMdUrl = getOrganizationMetadata(
          organization?.metadata,
        ).designMdUrl;

        if (organizationDesignMdUrl) {
          return ok(
            c,
            effectiveDesignMdSchema.parse({
              designMd: {
                label: DESIGN_MD_ATTACHMENT_LABEL,
                url: organizationDesignMdUrl,
              },
            }),
          );
        }
      }
    }

    const user = await userRepository.getUserById(resolvedUserId, prisma);
    const userDesignMdUrl = getUserMetadata(user?.metadata).designMdUrl;

    return ok(
      c,
      effectiveDesignMdSchema.parse({
        designMd: userDesignMdUrl
          ? { label: DESIGN_MD_ATTACHMENT_LABEL, url: userDesignMdUrl }
          : null,
      }),
    );
  });
}
