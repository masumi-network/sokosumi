import { createRoute } from "@hono/zod-openapi";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { rethrow } from "@/routes/v1/cmo/helpers";
import {
  cmoProjectParamsSchema,
  cmoTestCopyCheckSchema,
} from "@/schemas/cmo.schema";
import { checkTestCopyFor } from "@/services/cmo-test-copy.service";

const route = createRoute({
  method: "get",
  path: "/projects/{projectId}/test-copy",
  operationId: "checkCmoTestCopyForProject",
  tags: ["CMO"],
  description:
    "Says what is left of a CMO test copy (ADR 0073): unsent posts, linked accounts, running turns and a live Cuso. `clean` is true once a teardown left nothing. `publishedPosts` and `providerRevocations` are 0 for every test copy: it never publishes and never ends an account at the provider. Any member of the copy's organization reads it, before and after the teardown.",
  request: { params: cmoProjectParamsSchema },
  responses: {
    200: jsonSuccessResponse(cmoTestCopyCheckSchema, "What is left"),
    401: jsonErrorResponse("Unauthorized"),
    404: jsonErrorResponse("No such Project, or it is not a test copy"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { userId } = requireUserAuthContext(c.var.authContext);
    const { projectId } = c.req.valid("param");
    return ok(c, await checkTestCopyFor({ userId, projectId }).catch(rethrow));
  });
}
