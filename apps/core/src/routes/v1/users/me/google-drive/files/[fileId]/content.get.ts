import { createRoute, z } from "@hono/zod-openapi";

import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { getFileContent } from "@/services/google-drive";

import { getValidAccessToken } from "../../utils.js";

const paramsSchema = z.object({
  fileId: z.string().min(1),
});

const querySchema = z.object({
  mimeType: z.string().optional(),
});

const contentResponseSchema = z.object({
  content: z.string(),
  encoding: z.enum(["utf-8", "base64"]),
});

const route = createRoute({
  method: "get",
  path: "/google-drive/files/:fileId/content",
  description: "Download file content from Google Drive",
  tags: ["Google Drive"],
  request: {
    params: paramsSchema,
    query: querySchema,
  },
  responses: {
    200: jsonSuccessResponse(contentResponseSchema, "File content"),
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
    const { mimeType } = c.req.valid("query");

    const accessToken = await getValidAccessToken(authContext.userId);
    const result = await getFileContent(accessToken, fileId, mimeType);

    if (typeof result === "string") {
      return ok(c, { content: result, encoding: "utf-8" as const });
    }

    return ok(c, {
      content: result.toString("base64"),
      encoding: "base64" as const,
    });
  });
}
