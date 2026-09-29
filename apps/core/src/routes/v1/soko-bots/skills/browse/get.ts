import { createRoute, z } from "@hono/zod-openapi";
import { unprocessableEntity } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import { type OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { sokoBotSkillBrowseSchema } from "@/schemas/soko-bot.schema";
import {
  browseSkillsSh,
  SokoBotSkillError,
} from "@/services/soko-bot-skills.service";

const browseSkillsRoute = createRoute({
  method: "get",
  path: "/skills/browse",
  operationId: "browseSokoBotSkills",
  tags: ["Soko Bots"],
  request: {
    query: z.object({
      page: z.coerce.number().int().min(0).max(50).default(0),
    }),
  },
  responses: {
    200: jsonSuccessResponse(
      sokoBotSkillBrowseSchema,
      "skills.sh leaderboard page",
    ),
    401: jsonErrorResponse("Unauthorized"),
    422: jsonErrorResponse("Unprocessable Entity"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(browseSkillsRoute, async (c) => {
    requireUserAuthContext(c.var.authContext);
    try {
      return ok(
        c,
        sokoBotSkillBrowseSchema.parse(
          await browseSkillsSh(c.req.valid("query").page),
        ),
      );
    } catch (error) {
      if (error instanceof SokoBotSkillError) {
        throw unprocessableEntity(error.message);
      }
      throw error;
    }
  });
}
