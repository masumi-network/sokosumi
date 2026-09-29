import { createRoute } from "@hono/zod-openapi";

import { badRequest } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import { findTransactionDailySpend } from "@/helpers/transaction-history";
import prisma from "@/lib/db/prisma";
import {
  type OpenAPIHonoWithAuth,
  withOrganizationSlugHeaderParameter,
} from "@/lib/hono";
import { requireOwnerUserContext } from "@/middleware/auth";
import { requireWorkspaceContext } from "@/middleware/workspace";
import { transactionDailySpendListSchema } from "@/schemas/transaction-history.schema";
import {
  toInstantRange,
  transactionDateRangeQuerySchema,
  transactionFilterQuerySchema,
} from "../query.js";

const DEFAULT_DAYS = 30;
const MAX_DAYS = 366;
const DAY_MS = 86_400_000;

const route = withOrganizationSlugHeaderParameter(
  createRoute({
    method: "get",
    path: "/daily",
    description: `Credits spent per UTC day, one entry per day in the range, zero where nothing was spent. Defaults to the last ${DEFAULT_DAYS} days. Takes the same filters as the list.`,
    tags: ["Transactions"],
    request: {
      query: transactionFilterQuerySchema.extend(
        transactionDateRangeQuerySchema.shape,
      ),
    },
    responses: {
      200: jsonSuccessResponse(
        transactionDailySpendListSchema,
        "Retrieve daily credit spend",
      ),
      400: jsonErrorResponse("Bad Request"),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      500: jsonErrorResponse("Internal Server Error"),
    },
  }),
);

function toDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const userContext = requireOwnerUserContext(c.var.authContext);
    const workspaceContext = requireWorkspaceContext(c.var.workspaceContext);
    const query = c.req.valid("query");
    const today = toDay(Date.now());
    const to = query.to ?? today;
    const from =
      query.from ??
      toDay(Date.parse(`${to}T00:00:00Z`) - (DEFAULT_DAYS - 1) * DAY_MS);
    const range = toInstantRange({ from, to });

    if (!range?.from || !range.to) {
      throw badRequest("`from` must not be after `to`");
    }

    const start = range.from.getTime();
    const days = (range.to.getTime() - start) / DAY_MS;
    if (days > MAX_DAYS) {
      throw badRequest(`Range is limited to ${MAX_DAYS} days`);
    }

    const spend = await findTransactionDailySpend(
      {
        ...range,
        kinds: query.types,
        projectId: query.projectId === "null" ? null : query.projectId,
        q: query.q,
        scope: query.scope,
        userContext,
        workspaceContext,
      },
      prisma,
    );
    const creditsByDate = new Map(spend.map((row) => [row.date, row.credits]));
    const series = Array.from({ length: days }, (_, index) => {
      const date = toDay(start + index * DAY_MS);
      return { date, credits: creditsByDate.get(date) ?? 0 };
    });

    return ok(c, series);
  });
}
