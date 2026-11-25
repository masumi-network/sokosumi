import { createRoute } from "@hono/zod-openapi";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import {
  type OpenAPIHonoWithAuth,
  withCoworkerContextHeaderParameters,
} from "@/lib/hono";
import { fundraisingPipelineSchema } from "@/schemas/fundraising.schema";
import { listFundraisingPipeline } from "@/services/fundraising.service";
import { fundraisingActor } from "./context";

const route = withCoworkerContextHeaderParameters(
  createRoute({
    method: "get",
    path: "/",
    tags: ["Fundraising"],
    description:
      "The raise: every contact on the workspace's Investors list with its stage, owner, cheque, notes and data room activity. 404 when the organization has no Fundraising.",
    responses: {
      200: jsonSuccessResponse(fundraisingPipelineSchema, "Pipeline"),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("Not Found"),
    },
  }),
);

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const actor = await fundraisingActor(c);
    return ok(
      c,
      fundraisingPipelineSchema.parse(await listFundraisingPipeline(actor)),
    );
  });
}
