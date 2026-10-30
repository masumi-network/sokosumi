import { createRoute } from "@hono/zod-openapi";

import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { created } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import {
  marketingStrategyParamsSchema,
  marketingStrategyRequestSchema,
  marketingStrategySchema,
} from "@/schemas/marketing-strategy.schema";
import { createMarketingStrategy } from "@/services/marketing-strategy.service";

import { requireWorkspaceProject } from "../access";
import { mapMarketingStrategy } from "./context";

const route = createRoute({
  method: "post",
  path: "/{id}/marketing-strategies",
  operationId: "createProjectMarketingStrategy",
  tags: ["Projects"],
  description:
    "A member writes a new version of the Project's Marketing strategy, as its author. No other version changes; it runs only once an owner or admin approves it.",
  request: {
    params: marketingStrategyParamsSchema.pick({ id: true }),
    body: {
      required: true,
      content: {
        "application/json": { schema: marketingStrategyRequestSchema },
      },
    },
  },
  responses: {
    201: jsonSuccessResponse(
      marketingStrategySchema,
      "Marketing strategy version written",
    ),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
  },
});

export default function mount(app: Pick<OpenAPIHonoWithAuth, "openapi">): void {
  app.openapi(route, async (c) => {
    // A person writes a version; bots write theirs through their turns.
    const { userId } = requireUserAuthContext(c.var.authContext);
    const { projectId } = await requireWorkspaceProject(
      c,
      c.req.valid("param").id,
      userId,
    );
    const version = await createMarketingStrategy({
      projectId,
      userId,
      plan: c.req.valid("json").plan,
    });
    return created(
      c,
      marketingStrategySchema.parse(mapMarketingStrategy(version)),
    );
  });
}
