"use server";

import { err, ok } from "neverthrow";
import { revalidatePath } from "next/cache";
import * as z from "zod";

import {
  type ActionResultDto,
  toActionResult,
} from "@/lib/actions/action-result";
import type { ActionError } from "@/lib/actions/errors/action-error";
import { CommonErrorCode } from "@/lib/actions/errors/error-codes/common";
import { toCoreApiActionError } from "@/lib/clients/core.client";
import { competitorsService } from "@/lib/services/competitors.service";
import {
  type AuthenticatedRequest,
  withSession,
} from "@/middleware/auth-middleware";

const id = z.string().trim().min(1);
const field = z.string().trim().max(500).nullable().optional();
const fields = {
  websiteUrl: field,
  pricingUrl: field,
  instagramHandle: field,
  facebookHandle: field,
};

/**
 * A competitors action: input validated against `schema`, then `run` against
 * Core, whose refusal (the limit, a name taken, not an address) comes back as
 * its own message. Every one changes the page, so it is re-rendered.
 */
function competitorsAction<S extends z.ZodType, T>(
  schema: S,
  run: (input: z.output<S>) => Promise<T>,
) {
  return withSession<
    z.input<S> & AuthenticatedRequest,
    ActionResultDto<T, ActionError>
  >(async (params) => {
    const parsed = schema.safeParse(params);
    if (!parsed.success) {
      return toActionResult(
        err({
          code: CommonErrorCode.BAD_INPUT,
          message: parsed.error.issues[0]?.message ?? "Invalid input",
        }),
      );
    }
    try {
      const result = await run(parsed.data);
      revalidatePath("/competitors");
      return toActionResult(ok(result));
    } catch (error) {
      return toActionResult(err(toCoreApiActionError(error)));
    }
  });
}

export const addCompetitor = competitorsAction(
  z.object({
    projectId: id,
    name: z.string().trim().min(1).max(80),
    ...fields,
  }),
  async ({ projectId, ...body }) => {
    await competitorsService.add(projectId, body);
  },
);

export const updateCompetitor = competitorsAction(
  z.object({
    projectId: id,
    competitorId: id,
    name: z.string().trim().min(1).max(80),
    ...fields,
  }),
  async ({ projectId, competitorId, ...body }) => {
    await competitorsService.update(projectId, competitorId, body);
  },
);

export const removeCompetitor = competitorsAction(
  z.object({ projectId: id, competitorId: id }),
  async ({ projectId, competitorId }) => {
    await competitorsService.remove(projectId, competitorId);
  },
);

export const setCompetitorChecks = competitorsAction(
  z.object({ projectId: id, on: z.boolean() }),
  async ({ projectId, on }) => {
    await competitorsService.setChecks(projectId, on);
  },
);

/** Runs the check that is due and says how it went. */
export const runCompetitorCheck = competitorsAction(
  z.object({ projectId: id }),
  async ({ projectId }) =>
    (await competitorsService.runCheck(projectId)).outcome,
);

/** Finds competitors to pick from; the page changes only when some are added. */
export const findCompetitors = competitorsAction(
  z.object({ projectId: id }),
  ({ projectId }) => competitorsService.suggest(projectId),
);

/**
 * Adds the suggestions a member picked, in the order shown. Stops at the
 * first one Core refuses, so its message names what went wrong.
 */
export const addSuggestedCompetitors = competitorsAction(
  z.object({
    projectId: id,
    competitors: z
      .array(
        z.object({
          name: z.string().trim().min(1).max(80),
          websiteUrl: z.string().trim().max(500),
        }),
      )
      .min(1)
      .max(8),
  }),
  async ({ projectId, competitors }) => {
    for (const competitor of competitors)
      await competitorsService.add(projectId, {
        ...competitor,
        suggested: true,
      });
  },
);
