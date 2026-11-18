import { createRoute, z } from "@hono/zod-openapi";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { rethrow } from "@/routes/v1/cmo/helpers";
import { cmoProjectParamsSchema } from "@/schemas/cmo.schema";
import { setCmoPresenter } from "@/services/cmo-presenter.service";

const bodySchema = z
  .object({
    /** The photo, base64, under 3 MB once decoded. */
    photo: z.string().min(1).max(4_200_000),
    /** The owner confirmed they are the person shown or may use the photo. */
    consent: z.literal(true),
  })
  .openapi("CmoPresenterPhoto");

const route = createRoute({
  method: "put",
  path: "/projects/{projectId}/presenter",
  operationId: "setCmoPresenterForProject",
  tags: ["CMO"],
  description:
    "The owner's photo, to front Cuso's talking videos. Needs the owner's consent, which is stored with it; Cuso then may choose the owner as presenter.",
  request: {
    params: cmoProjectParamsSchema,
    body: {
      required: true,
      content: { "application/json": { schema: bodySchema } },
    },
  },
  responses: {
    200: jsonSuccessResponse(
      z.object({ presenterSet: z.literal(true) }),
      "Photo saved",
    ),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Cuso is not hired yet"),
    422: jsonErrorResponse("Not a usable photo"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { userId } = requireUserAuthContext(c.var.authContext);
    const { projectId } = c.req.valid("param");
    const { photo } = c.req.valid("json");
    await setCmoPresenter({
      userId,
      projectId,
      photo: new Uint8Array(Buffer.from(photo, "base64")),
    }).catch(rethrow);
    return ok(c, { presenterSet: true as const });
  });
}
