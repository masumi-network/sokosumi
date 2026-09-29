import { createRoute, z } from "@hono/zod-openapi";
import { unprocessableEntity } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import { type OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { sokoBotSkillSearchResultSchema } from "@/schemas/soko-bot.schema";
import {
  SokoBotSkillError,
  searchSkillsSh,
} from "@/services/soko-bot-skills.service";

const searchSkillsRoute = createRoute({
  method: "get",
  path: "/skills/search",
  operationId: "searchSokoBotSkills",
  tags: ["Soko Bots"],
  request: { query: z.object({ q: z.string().trim().min(1).max(100) }) },
  responses: {
    200: jsonSuccessResponse(
      z.array(sokoBotSkillSearchResultSchema),
      "skills.sh results",
    ),
    401: jsonErrorResponse("Unauthorized"),
    422: jsonErrorResponse("Unprocessable Entity"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(searchSkillsRoute, async (c) => {
    requireUserAuthContext(c.var.authContext);
    try {
      return ok(c, await searchSkillsSh(c.req.valid("query").q));
    } catch (error) {
      if (error instanceof SokoBotSkillError) {
        throw unprocessableEntity(error.message);
      }
      throw error;
    }
  });
}
