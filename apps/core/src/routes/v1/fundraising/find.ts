import { createRoute } from "@hono/zod-openapi";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import {
  type OpenAPIHonoWithAuth,
  withCoworkerContextHeaderParameters,
} from "@/lib/hono";
import {
  fundraisingFindInputSchema,
  fundraisingFindResultSchema,
} from "@/schemas/fundraising.schema";
import { findInvestors } from "@/services/fundraising-research.service";
import { fundraisingActor } from "./context";

const route = withCoworkerContextHeaderParameters(
  createRoute({
    method: "post",
    path: "/find",
    tags: ["Fundraising"],
    description:
      "Asks Exa's agent for investors who fit the brief and keeps them as suggestions on the Investors list. One flat Exa charge per search, recorded against the month's research cap; people already on the list or already suggested are skipped.",
    request: {
      body: {
        content: { "application/json": { schema: fundraisingFindInputSchema } },
      },
    },
    responses: {
      200: jsonSuccessResponse(fundraisingFindResultSchema, "Found"),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("Not Found"),
      422: jsonErrorResponse(
        "No Investors list, Exa missing, or the cap is reached",
      ),
      503: jsonErrorResponse("Exa did not answer"),
    },
  }),
);

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const actor = await fundraisingActor(c);
    return ok(
      c,
      fundraisingFindResultSchema.parse(
        await findInvestors(actor, c.req.valid("json")),
      ),
    );
  });
}
