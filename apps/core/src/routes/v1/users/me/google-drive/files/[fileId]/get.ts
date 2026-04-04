import { createRoute, z } from "@hono/zod-openapi";

import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { getFile } from "@/services/google-drive";

import { getValidAccessToken } from "../../utils.js";

const paramsSchema = z.object({
  fileId: z.string().min(1),
});

const driveFileSchema = z.object({
  id: z.string(),
  name: z.string(),
  mimeType: z.string(),
  createdTime: z.string().optional(),
  modifiedTime: z.string().optional(),
  size: z.string().optional(),
  parents: z.array(z.string()).optional(),
  webViewLink: z.string().optional(),
  iconLink: z.string().optional(),
});

const route = createRoute({
  method: "get",
  path: "/google-drive/files/:fileId",
  description: "Get file metadata from Google Drive",
  tags: ["Google Drive"],
  request: {
    params: paramsSchema,
  },
  responses: {
    200: jsonSuccessResponse(driveFileSchema, "File metadata"),
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
    const file = await getFile(accessToken, fileId);

    return ok(c, file);
  });
}
