import { createRoute } from "@hono/zod-openapi";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { rethrow } from "@/routes/v1/cmo/helpers";
import {
  cmoDraftParamsSchema,
  cmoTikTokCreatorSchema,
} from "@/schemas/cmo.schema";
import { readCmoTikTokCreator } from "@/services/cmo-drafts.service";

const route = createRoute({
  method: "get",
  path: "/projects/{projectId}/drafts/{postId}/tiktok",
  operationId: "readCmoTikTokCreatorForDraft",
  tags: ["CMO"],
  description:
    "What TikTok allows on the account a waiting video goes to, read from TikTok now: who it posts as, who may see it, and whether comments, Duet and Stitch can be turned on. TikTok asks an app to show these before each post.",
  request: { params: cmoDraftParamsSchema },
  responses: {
    200: jsonSuccessResponse(cmoTikTokCreatorSchema, "The creator's options"),
    401: jsonErrorResponse("Unauthorized"),
    404: jsonErrorResponse("Cuso is not hired yet, or no such TikTok post"),
    409: jsonErrorResponse(
      "TikTok is not connected, or needs connecting again",
    ),
    503: jsonErrorResponse("TikTok could not be read right now"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { userId } = requireUserAuthContext(c.var.authContext);
    const { projectId, postId } = c.req.valid("param");
    c.header("Cache-Control", "no-store");
    return ok(
      c,
      await readCmoTikTokCreator({ userId, projectId, postId }).catch(rethrow),
    );
  });
}
