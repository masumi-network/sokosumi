import { createRoute, z } from "@hono/zod-openapi";

import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { updateFileContent } from "@/services/google-drive";

import { getValidAccessToken } from "../../utils.js";

const paramsSchema = z.object({
  fileId: z.string().min(1),
});

const updateBodySchema = z.object({
  content: z.string(),
  mimeType: z.string().min(1),
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
  method: "patch",
  path: "/google-drive/files/:fileId",
  description: "Update file content in Google Drive",
  tags: ["Google Drive"],
  request: {
    params: paramsSchema,
    body: {
      required: true,
      content: {
        "application/json": {
          schema: updateBodySchema,
        },
      },
    },
  },
  responses: {
    200: jsonSuccessResponse(driveFileSchema, "File updated"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
    422: jsonErrorResponse("Unprocessable Entity"),
    500: jsonErrorResponse("Internal Server Error"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const authContext = requireUserAuthContext(c.var.authContext);
    const { fileId } = c.req.valid("param");
    const { content, mimeType } = c.req.valid("json");

    const accessToken = await getValidAccessToken(authContext.userId);
    const file = await updateFileContent(accessToken, fileId, content, mimeType);

    return ok(c, file);
  });
}
