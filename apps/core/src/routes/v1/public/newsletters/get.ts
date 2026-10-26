import { createRoute, type OpenAPIHono } from "@hono/zod-openapi";

import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import {
  publicNewsletterParamsSchema,
  publicNewsletterSchema,
} from "@/schemas/newsletter.schema";
import { getPublicNewsletter } from "@/services/newsletter-signup.service";

const route = createRoute({
  method: "get",
  path: "/{publicSlug}",
  tags: ["Newsletter"],
  security: [],
  description:
    "Public newsletter name, sender name and brand for hosted pages.",
  request: { params: publicNewsletterParamsSchema },
  responses: {
    200: jsonSuccessResponse(publicNewsletterSchema, "Public newsletter"),
    404: jsonErrorResponse("Not Found"),
    422: jsonErrorResponse("Unprocessable Entity"),
  },
});

export default function mount(app: OpenAPIHono) {
  app.openapi(route, async (c) => {
    const { publicSlug } = c.req.valid("param");
    return ok(
      c,
      publicNewsletterSchema.parse(await getPublicNewsletter(publicSlug)),
    );
  });
}
