import { createRoute, z } from "@hono/zod-openapi";
import { jsonErrorResponse } from "@/helpers/openapi";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { rethrow } from "@/routes/v1/cmo/helpers";
import { cmoPictureParamsSchema } from "@/schemas/cmo.schema";
import { readCmoPicturePreview } from "@/services/cmo-pictures.service";

const route = createRoute({
  method: "get",
  path: "/projects/{projectId}/pictures/{jobId}/image",
  operationId: "getCmoPictureImageForProject",
  tags: ["CMO"],
  description:
    "One of Cuso's month pictures as a JPEG preview (at most 720 px), chosen or not, for the Pictures page. The originals stay private; this is read through CMO's own server.",
  request: { params: cmoPictureParamsSchema },
  responses: {
    200: {
      description: "The picture",
      content: {
        "image/jpeg": { schema: z.string().openapi({ format: "binary" }) },
      },
    },
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("No such picture"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { userId } = requireUserAuthContext(c.var.authContext);
    const { projectId, jobId } = c.req.valid("param");
    const bytes = await readCmoPicturePreview({
      userId,
      projectId,
      jobId,
    }).catch(rethrow);
    return c.body(new Uint8Array(bytes), 200, {
      "Content-Type": "image/jpeg",
      "Cache-Control": "private, max-age=3600",
    });
  });
}
