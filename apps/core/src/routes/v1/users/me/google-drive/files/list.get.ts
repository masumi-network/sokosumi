import { createRoute, z } from "@hono/zod-openapi";

import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { listFiles } from "@/services/google-drive";

import { getValidAccessToken } from "../utils.js";

const querySchema = z.object({
  folderId: z.string().optional(),
  query: z.string().optional(),
  pageSize: z.coerce.number().min(1).max(100).optional(),
  pageToken: z.string().optional(),
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

const driveFileListSchema = z.object({
  files: z.array(driveFileSchema),
  nextPageToken: z.string().optional(),
});

const route = createRoute({
  method: "get",
  path: "/google-drive/files",
  description: "List files from connected Google Drive",
  tags: ["Google Drive"],
  request: {
    query: querySchema,
  },
  responses: {
    200: jsonSuccessResponse(driveFileListSchema, "List of Drive files"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
    500: jsonErrorResponse("Internal Server Error"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const authContext = requireUserAuthContext(c.var.authContext);
    const { folderId, query, pageSize, pageToken } = c.req.valid("query");

    const accessToken = await getValidAccessToken(authContext.userId);
    const result = await listFiles(accessToken, {
      folderId,
      query,
      pageSize,
      pageToken,
    });

    return ok(c, result);
  });
}
