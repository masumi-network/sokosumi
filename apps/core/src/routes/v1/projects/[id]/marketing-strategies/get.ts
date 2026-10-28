import { createRoute, z } from "@hono/zod-openapi";

import { requireAuthorizedUserContext } from "@/helpers/coworker-user-context-binding";
import {
  jsonErrorResponse,
  jsonPaginatedSuccessResponse,
} from "@/helpers/openapi";
import {
  createPaginationMeta,
  parseCursorPagination,
} from "@/helpers/pagination";
import { ok } from "@/helpers/response";
import {
  type OpenAPIHonoWithAuth,
  withCoworkerContextHeaderParameters,
} from "@/lib/hono";
import {
  marketingStrategyParamsSchema,
  marketingStrategyVersionSchema,
} from "@/schemas/marketing-strategy.schema";
import { cursorPaginationQuerySchema } from "@/schemas/pagination.schema";
import { listMarketingStrategies } from "@/services/marketing-strategy.service";

import { requireWorkspaceProject } from "../access";

const route = withCoworkerContextHeaderParameters(
  createRoute({
    method: "get",
    path: "/{id}/marketing-strategies",
    operationId: "listProjectMarketingStrategies",
    tags: ["Projects"],
    description:
      "The versions of the Project's Marketing strategy, newest first, without their plans (paginated). At most one is approved.",
    request: {
      params: marketingStrategyParamsSchema.pick({ id: true }),
      query: cursorPaginationQuerySchema,
    },
    responses: {
      200: jsonPaginatedSuccessResponse(
        z.array(marketingStrategyVersionSchema),
        "Marketing strategy versions",
      ),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("Not Found"),
    },
  }),
);

export default function mount(app: Pick<OpenAPIHonoWithAuth, "openapi">): void {
  app.openapi(route, async (c) => {
    const { userId } = await requireAuthorizedUserContext(c.var.authContext);
    const { projectId } = await requireWorkspaceProject(
      c,
      c.req.valid("param").id,
      userId,
    );
    const { cursor, take, skip } = parseCursorPagination(c.req.valid("query"));
    const [versions, total] = await listMarketingStrategies(projectId, {
      cursor,
      take: take + 1,
      skip,
    });
    const page = versions.slice(0, take);
    return ok(
      c,
      page.map(({ turnId: _turnId, ...version }) =>
        marketingStrategyVersionSchema.parse(version),
      ),
      createPaginationMeta(page, total, take, versions.length > take, cursor),
    );
  });
}
