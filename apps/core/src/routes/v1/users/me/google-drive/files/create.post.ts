import { createRoute, z } from "@hono/zod-openapi";

import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { created } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { createFile } from "@/services/google-drive";

import { getValidAccessToken } from "../utils.js";

const createFileBodySchema = z.object({
  name: z.string().min(1),
  content: z.string(),
  mimeType: z.string().min(1),
  folderId: z.string().optional(),
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
  method: "post",
  path: "/google-drive/files",
  description: "Create / upload a file to Google Drive",
  tags: ["Google Drive"],
  request: {
    body: {
      required: true,
      content: {
        "application/json": {
          schema: createFileBodySchema,
        },
      },
    },
  },
  responses: {
    201: jsonSuccessResponse(driveFileSchema, "File created"),
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
    const { name, content, mimeType, folderId } = c.req.valid("json");

    const accessToken = await getValidAccessToken(authContext.userId);
    const file = await createFile(accessToken, name, content, mimeType, folderId);

    return created(c, file);
  });
}
