import { createRoute, z } from "@hono/zod-openapi";

import { requireDriveFileWriteAccess } from "@/helpers/drive-file-access";
import { jsonErrorResponse } from "@/helpers/openapi";
import {
  deleteOrganizationDriveFileIfOwned,
  deleteUserDriveFileIfOwned,
} from "@/lib/blob";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";

const paramsSchema = z.object({
  id: z.string().openapi({
    param: { name: "id", in: "path" },
    example: "drv_123abc",
  }),
});

const route = createRoute({
  method: "delete",
  path: "/{id}",
  description: [
    "Delete a drive file (blob + row).",
    "Personal: owner only.",
    "Organization: uploader or org admin.",
  ].join("\n"),
  tags: ["Drive"],
  request: {
    params: paramsSchema,
  },
  responses: {
    204: {
      description: "Drive file deleted",
    },
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { authContext } = c.var;
    const { id: fileId } = c.req.valid("param");

    // ACL check
    const file = await requireDriveFileWriteAccess(authContext, fileId);

    // Delete blob (best-effort, ownership-checked)
    if (file.userId) {
      await deleteUserDriveFileIfOwned(file.fileUrl, file.userId);
    } else if (file.organizationId) {
      await deleteOrganizationDriveFileIfOwned(
        file.fileUrl,
        file.organizationId,
      );
    }

    // Delete row
    await prisma.driveFile.delete({
      where: { id: fileId },
    });

    return c.body(null, 204);
  });
}
