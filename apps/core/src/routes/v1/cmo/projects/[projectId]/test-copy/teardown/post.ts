import { createRoute } from "@hono/zod-openapi";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { rethrow } from "@/routes/v1/cmo/helpers";
import {
  cmoProjectParamsSchema,
  cmoTestCopyTeardownSchema,
} from "@/schemas/cmo.schema";
import { tearDownTestCopyFor } from "@/services/cmo-test-copy.service";

const route = createRoute({
  method: "post",
  path: "/projects/{projectId}/test-copy/teardown",
  operationId: "tearDownCmoTestCopyForProject",
  tags: ["CMO"],
  description:
    "Tears a CMO test copy down (ADR 0073) and reports what it removed: cancels every post that has not gone out, stops his runs, archives his Cuso (his Tester credits are written off) and disconnects the links to the source's accounts, without asking a provider for anything. An owner or admin of the organization, or whoever made the copy. Safe to call again: it removes nothing more and answers the same check. Core does the same by itself to any copy older than six hours.",
  request: { params: cmoProjectParamsSchema },
  responses: {
    200: jsonSuccessResponse(
      cmoTestCopyTeardownSchema,
      "What was removed, and what is left",
    ),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse(
      "Only an owner or admin, or whoever made the test copy",
    ),
    404: jsonErrorResponse("No such Project, or it is not a test copy"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { userId } = requireUserAuthContext(c.var.authContext);
    const { projectId } = c.req.valid("param");
    return ok(
      c,
      await tearDownTestCopyFor({ userId, projectId }).catch(rethrow),
    );
  });
}
