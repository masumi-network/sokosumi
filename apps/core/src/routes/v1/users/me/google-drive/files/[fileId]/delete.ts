import { createRoute, z } from "@hono/zod-openapi";

import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { deleteFile } from "@/services/google-drive";

import { getValidAccessToken } from "../../utils.js";

const paramsSchema = z.object({
  fileId: z.string().min(1),
});

const deleteResponseSchema = z.object({
  deleted: z.boolean(),
});

const route = createRoute({
  method: "delete",
  path: "/google-drive/files/:fileId",
  description: "Delete a file from Google Drive",
  tags: ["Google Drive"],
  request: {
    params: paramsSchema,
  },
  responses: {
    200: jsonSuccessResponse(deleteResponseSchema, "File deleted"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
    500: jsonErrorResponse("Internal Server Error"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const authContext = requireUserAuthContext(c.var.authContext);
    const { fileId } = c.req.valid("param");

    const accessToken = await getValidAccessToken(authContext.userId);
    await deleteFile(accessToken, fileId);

    return ok(c, { deleted: true });
  });
}
