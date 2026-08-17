import { createRoute, z } from "@hono/zod-openapi";
import { clampDriveFileName } from "@sokosumi/utils";

import { requireDriveFileWriteAccess } from "@/helpers/drive-file-access";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { DriveFile } from "@/schemas/drive-file.schema";
import {
  driveFileSchema,
  renameDriveFileRequestSchema,
} from "@/schemas/drive-file.schema";

const paramsSchema = z.object({
  id: z.string().openapi({
    param: { name: "id", in: "path" },
    example: "drv_123abc",
  }),
});

const route = createRoute({
  method: "patch",
  path: "/{id}",
  description: [
    "Rename a drive file.",
    "Personal: owner only.",
    "Organization: uploader or org admin.",
  ].join("\n"),
  tags: ["Drive"],
  request: {
    params: paramsSchema,
    body: {
      required: true,
      content: {
        "application/json": {
          schema: renameDriveFileRequestSchema,
        },
      },
    },
  },
  responses: {
    200: jsonSuccessResponse(driveFileSchema, "Drive file renamed"),
    400: jsonErrorResponse("Bad Request"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { authContext } = c.var;
    const { id: fileId } = c.req.valid("param");
    const body = c.req.valid("json");

    // ACL check
    await requireDriveFileWriteAccess(authContext, fileId);

    const newName = clampDriveFileName(body.name);

    const updated = await prisma.driveFile.update({
      where: { id: fileId },
      data: { name: newName },
    });

    const scope = updated.userId ? "me" : "org";
    const ownerId = updated.userId ?? updated.organizationId!;

    const apiFile: DriveFile = {
      id: updated.id,
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString(),
      name: updated.name,
      fileUrl: updated.fileUrl,
      pathname: updated.pathname,
      mimeType: updated.mimeType,
      size: updated.size ? Number(updated.size) : null,
      scope,
      ownerId,
      uploadedByUserId: updated.uploadedByUserId,
    };

    return ok(c, driveFileSchema.parse(apiFile));
  });
}
