import { createRoute, z } from "@hono/zod-openapi";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { rethrow } from "@/routes/v1/cmo/helpers";
import { cmoProjectParamsSchema } from "@/schemas/cmo.schema";
import {
  requestCmoArticle,
  requestCmoArticleIdeas,
} from "@/services/cmo-seo.service";

const route = createRoute({
  method: "post",
  path: "/projects/{projectId}/seo/ideas",
  operationId: "requestCmoArticleIdeasForProject",
  tags: ["CMO"],
  description:
    "More article ideas: Cuso researches keywords and saves new article suggestions. With write, he picks the best search and writes one whole article instead. His answer lands in the chat.",
  request: {
    params: cmoProjectParamsSchema,
    body: {
      required: false,
      content: {
        "application/json": {
          schema: z.object({ write: z.boolean().optional() }),
        },
      },
    },
  },
  responses: {
    200: jsonSuccessResponse(z.object({ turnId: z.string() }), "Cuso started"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Cuso is not hired"),
    409: jsonErrorResponse("Cuso is paused or out of credits"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { userId } = requireUserAuthContext(c.var.authContext);
    const { projectId } = c.req.valid("param");
    const body = await c.req.json().catch(() => ({}));
    const write = z.object({ write: z.boolean().optional() }).safeParse(body)
      .data?.write;
    return ok(
      c,
      await (write
        ? requestCmoArticle({ userId, projectId })
        : requestCmoArticleIdeas({ userId, projectId })
      ).catch(rethrow),
    );
  });
}
