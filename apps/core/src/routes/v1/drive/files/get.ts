import { createRoute, z } from "@hono/zod-openapi";

import {
  listOrganizationDriveFiles,
  listUserDriveFiles,
  requireOrganizationDriveFileUploadAccess,
} from "@/helpers/drive-file-access";
import { badRequest } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserContext } from "@/middleware/auth";
import type { DriveFile } from "@/schemas/drive-file.schema";
import {
  driveFileScopeSchema,
  driveFilesSchema,
} from "@/schemas/drive-file.schema";

const querySchema = z.object({
  scope: driveFileScopeSchema.openapi({
    param: { name: "scope", in: "query" },
    description: "Drive scope: 'me' for personal, 'org' for organization",
  }),
  organizationId: z
    .string()
    .optional()
    .openapi({
      param: { name: "organizationId", in: "query" },
      example: "org_123",
      description: "Organization ID (required when scope=org)",
    }),
});

const route = createRoute({
  method: "get",
  path: "/",
  description: "List drive files (personal or organization, newest first)",
  tags: ["Drive"],
  request: {
    query: querySchema,
  },
  responses: {
    200: jsonSuccessResponse(driveFilesSchema, "Drive files"),
    400: jsonErrorResponse("Bad Request"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { authContext } = c.var;
    const userContext = requireUserContext(authContext);
    const query = c.req.valid("query");

    let files: Awaited<
      ReturnType<typeof listUserDriveFiles | typeof listOrganizationDriveFiles>
    >;
    let ownerId: string;
    let scope: "me" | "org";

    if (query.scope === "me") {
      // Personal drive
      ownerId = userContext.userId;
      scope = "me";
      files = await listUserDriveFiles(ownerId);
    } else if (query.scope === "org") {
      if (!query.organizationId) {
        throw badRequest("organizationId is required when scope=org");
      }
      // Org drive (verify membership)
      ownerId = query.organizationId;
      scope = "org";
      await requireOrganizationDriveFileUploadAccess(authContext, ownerId);
      files = await listOrganizationDriveFiles(ownerId);
    } else {
      throw badRequest("Invalid scope. Must be 'me' or 'org'.");
    }

    // Map to API schema
    const apiFiles: DriveFile[] = files.map((file) => ({
      id: file.id,
      createdAt: file.createdAt.toISOString(),
      updatedAt: file.updatedAt.toISOString(),
      name: file.name,
      fileUrl: file.fileUrl,
      pathname: file.pathname,
      mimeType: file.mimeType,
      size: file.size ? Number(file.size) : null,
      scope,
      ownerId,
      uploadedByUserId: file.uploadedByUserId,
    }));

    return ok(c, driveFilesSchema.parse(apiFiles));
  });
}
