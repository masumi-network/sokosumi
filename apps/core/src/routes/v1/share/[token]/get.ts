import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import { notFound } from "@/helpers/error.js";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { getPublicSharedResourceByToken } from "@/helpers/public-share.js";
import { ok } from "@/helpers/response";
import { publicSharedResourceResponseSchema } from "@/schemas/public-share.schema.js";

const paramsSchema = z.object({
  token: z.string().openapi({
    param: { name: "token", in: "path" },
    example: "public-share-token",
  }),
});

const route = createRoute({
  method: "get",
  path: "/{token}",
  description: "Resolve a publicly shared resource by share token",
  tags: ["Share"],
  security: [],
  request: {
    params: paramsSchema,
  },
  responses: {
    200: jsonSuccessResponse(
      publicSharedResourceResponseSchema,
      "Resolve a publicly shared resource",
    ),
    404: jsonErrorResponse("Not Found"),
  },
});

export default function mount(app: OpenAPIHono) {
  app.openapi(route, async (c) => {
    const { token } = c.req.valid("param");
    const resource = await getPublicSharedResourceByToken(token);

    if (!resource) {
      throw notFound("Public share not found");
    }

    return ok(c, publicSharedResourceResponseSchema.parse(resource));
  });
}
