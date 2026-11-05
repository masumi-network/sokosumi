import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";

import { notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import {
  DRIVE_SHARE_UNLOCK_HEADER,
  publicDriveShareSchema,
} from "@/schemas/drive-share.schema";
import { readPublicDriveShare } from "@/services/drive-share.service";

const route = createRoute({
  method: "get",
  path: "/{token}",
  description: [
    "A shared Drive file or folder. Behind a password, only its name until",
    `the request carries an unlock proof in ${DRIVE_SHARE_UNLOCK_HEADER}.`,
  ].join("\n"),
  tags: ["Share"],
  security: [],
  request: { params: z.object({ token: z.string().max(200) }) },
  responses: {
    200: jsonSuccessResponse(publicDriveShareSchema, "Shared file or folder"),
    404: jsonErrorResponse("Not Found"),
  },
});

export default function mount(app: OpenAPIHono) {
  app.openapi(route, async (c) => {
    const share = await readPublicDriveShare(
      c.req.valid("param").token,
      c.req.header(DRIVE_SHARE_UNLOCK_HEADER),
    );
    if (!share) throw notFound("Shared file not found");
    return ok(c, publicDriveShareSchema.parse(share));
  });
}
