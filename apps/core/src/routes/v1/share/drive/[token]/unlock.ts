import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";

import { notFound, tooManyRequests, unauthorized } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import {
  unlockDriveShareRequestSchema,
  unlockDriveShareResponseSchema,
} from "@/schemas/drive-share.schema";
import { unlockDriveShare } from "@/services/drive-share.service";

const route = createRoute({
  method: "post",
  path: "/{token}/unlock",
  description:
    "Trade the link's password for an unlock proof. Ten wrong passwords lock the link for 15 minutes.",
  tags: ["Share"],
  security: [],
  request: {
    params: z.object({ token: z.string().max(200) }),
    body: {
      required: true,
      content: {
        "application/json": { schema: unlockDriveShareRequestSchema },
      },
    },
  },
  responses: {
    200: jsonSuccessResponse(unlockDriveShareResponseSchema, "Unlocked"),
    401: jsonErrorResponse("Wrong password"),
    404: jsonErrorResponse("Not Found"),
    429: jsonErrorResponse("Too many wrong passwords"),
  },
});

export default function mount(app: OpenAPIHono) {
  app.openapi(route, async (c) => {
    const outcome = await unlockDriveShare(
      c.req.valid("param").token,
      c.req.valid("json").password,
    );
    if (outcome.kind === "missing") throw notFound("Shared file not found");
    if (outcome.kind === "locked")
      throw tooManyRequests("Too many wrong passwords. Try again later.", {
        retryAfterSeconds: outcome.retryAfterSeconds,
      });
    if (outcome.kind === "wrong") throw unauthorized("Wrong password");
    return ok(
      c,
      unlockDriveShareResponseSchema.parse({ proof: outcome.proof }),
    );
  });
}
