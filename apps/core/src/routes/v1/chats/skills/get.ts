import { createRoute, z } from "@hono/zod-openapi";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { chatSkillCatalogItemSchema } from "@/schemas/chat-room.schema";
import { searchSkillCatalog } from "@/services/skill-catalog.service";

const route = createRoute({
  method: "get",
  path: "/",
  operationId: "searchChatSkills",
  description:
    "Search the skills.sh catalog for the chat skill picker, most installed first. Without a query, returns the top skills.",
  tags: ["Chat Rooms"],
  request: {
    query: z.object({
      q: z.string().trim().max(100).optional().openapi({ example: "react" }),
    }),
  },
  responses: {
    200: jsonSuccessResponse(
      z.array(chatSkillCatalogItemSchema),
      "Matching skills",
    ),
    401: jsonErrorResponse("Unauthorized"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    requireUserAuthContext(c.var.authContext);
    return ok(c, await searchSkillCatalog(c.req.valid("query").q ?? ""));
  });
}
