import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";

import { notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import {
  DRIVE_SHARE_UNLOCK_HEADER,
  driveShareDownloadResponseSchema,
} from "@/schemas/drive-share.schema";
import { driveShareDownloadUrl } from "@/services/drive-share.service";

const route = createRoute({
  method: "get",
  path: "/{token}/download",
  description:
    "Where to download one file of a shared link: the file itself, or `path` inside a shared folder.",
  tags: ["Share"],
  security: [],
  request: {
    params: z.object({ token: z.string().max(200) }),
    query: z.object({ path: z.string().max(1_000).optional() }),
  },
  responses: {
    200: jsonSuccessResponse(driveShareDownloadResponseSchema, "Download"),
    404: jsonErrorResponse("Not Found"),
  },
});

export default function mount(app: OpenAPIHono) {
  app.openapi(route, async (c) => {
    const url = await driveShareDownloadUrl({
      token: c.req.valid("param").token,
      proof: c.req.header(DRIVE_SHARE_UNLOCK_HEADER),
      path: c.req.valid("query").path,
    });
    if (!url) throw notFound("Shared file not found");
    return ok(c, driveShareDownloadResponseSchema.parse({ url }));
  });
}
