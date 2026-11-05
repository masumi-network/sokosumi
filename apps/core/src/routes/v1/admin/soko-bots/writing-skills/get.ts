import { createRoute } from "@hono/zod-openapi";
import { WRITING_SKILL_GROUPS, WRITING_SKILLS } from "@sokosumi/soko-bot";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireAdminAuthContext } from "@/middleware/auth";
import { adminWritingSkillsSchema } from "@/schemas/soko-bot.schema";

// The writing skills Cuso reads before he writes each kind of piece.
const writingSkillsRoute = createRoute({
  method: "get",
  path: "/writing-skills",
  operationId: "getAdminWritingSkills",
  tags: ["Admin"],
  responses: {
    200: jsonSuccessResponse(
      adminWritingSkillsSchema,
      "Writing skills by group",
    ),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(writingSkillsRoute, (c) => {
    requireAdminAuthContext(c.var.authContext);
    return ok(
      c,
      adminWritingSkillsSchema.parse({
        groups: WRITING_SKILL_GROUPS.map((group) => ({
          ...group,
          skills: WRITING_SKILLS.filter((skill) => skill.group === group.key),
        })),
      }),
    );
  });
}
