import { createRoute, z } from "@hono/zod-openapi";
import { MemberRole } from "@sokosumi/database";
import { bodyLimit } from "hono/body-limit";

import { LIMITS } from "@/config/constants";
import { getEnv } from "@/config/env";
import { payloadTooLarge, serviceUnavailable } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { resolveMemberOrganizationById } from "@/helpers/organization";
import { ok } from "@/helpers/response";
import { uploadOrganizationLogo } from "@/lib/blob";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { organizationWithRoleSchema } from "@/schemas/organization.schema";

const MULTIPART_FORM_OVERHEAD_BYTES = 256 * 1024;
const MAX_UPLOAD_REQUEST_SIZE_BYTES =
  LIMITS.ORGANIZATION_LOGO_MAX_SIZE_BYTES + MULTIPART_FORM_OVERHEAD_BYTES;

const params = z.object({
  id: z.string().openapi({
    param: { name: "id", in: "path" },
    description: "Organization ID",
    example: "org_123",
  }),
});

const uploadOrganizationLogoFormSchema = z.object({
  file: z
    .file({ error: "File is required" })
    .min(1, "File cannot be empty")
    .max(
      LIMITS.ORGANIZATION_LOGO_MAX_SIZE_BYTES,
      `File exceeds maximum size of ${LIMITS.ORGANIZATION_LOGO_MAX_SIZE_BYTES} bytes`,
    )
    .mime(
      ["image/png", "image/jpeg", "image/webp", "image/svg+xml", "image/gif"],
      "Unsupported file type",
    )
    .openapi({
      type: "string",
      format: "binary",
    }),
});

const route = createRoute({
  method: "put",
  path: "/{id}/logo",
  description: "Upload an organization logo",
  tags: ["Organizations"],
  middleware: bodyLimit({
    maxSize: MAX_UPLOAD_REQUEST_SIZE_BYTES,
    onError: () => {
      throw payloadTooLarge("Request body exceeds upload size limit");
    },
  }),
  request: {
    params,
    body: {
      required: true,
      content: {
        "multipart/form-data": {
          schema: uploadOrganizationLogoFormSchema,
        },
      },
    },
  },
  responses: {
    200: jsonSuccessResponse(
      organizationWithRoleSchema,
      "Organization logo uploaded successfully",
      {
        data: {
          id: "org_123",
          name: "My Organization",
          slug: "my-org",
          logo: "https://store.public.blob.vercel-storage.com/organizations/org_123/logo",
          createdAt: "2025-01-01T00:00:00.000Z",
          role: "owner",
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
    413: jsonErrorResponse("Payload Too Large"),
    422: jsonErrorResponse("Unprocessable Entity"),
    503: jsonErrorResponse("Service Unavailable"),
    500: jsonErrorResponse("Internal Server Error"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const authContext = requireUserAuthContext(c.var.authContext);
    const { id } = c.req.valid("param");
    const { file } = c.req.valid("form");

    const token = getEnv().BLOB_READ_WRITE_TOKEN;
    if (!token) {
      throw serviceUnavailable("Blob storage is not configured");
    }

    const organization = await prisma.$transaction(async (tx) => {
      const { organization, role } = await resolveMemberOrganizationById({
        id,
        userId: authContext.userId,
        tx,
        allowedRoles: [MemberRole.OWNER, MemberRole.ADMIN],
      });

      const logoUrl = await uploadOrganizationLogo(
        organization.id,
        file,
        token,
      );
      const updatedOrganization = await tx.organization.update({
        where: { id: organization.id },
        data: {
          logo: logoUrl,
        },
      });

      return {
        ...updatedOrganization,
        role,
      };
    });

    return ok(c, organizationWithRoleSchema.parse(organization));
  });
}
