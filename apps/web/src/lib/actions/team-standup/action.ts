"use server";

import { err, ok } from "neverthrow";
import { z } from "zod";
import { toActionResult } from "@/lib/actions/action-result";
import { CommonErrorCode } from "@/lib/actions/errors/error-codes/common";
import { toCoreApiActionError } from "@/lib/clients/core.client";
import { teamStandupService } from "@/lib/services/team-standup.service";
import {
  type AuthenticatedRequest,
  withSession,
} from "@/middleware/auth-middleware";

const standupSchema = z.object({
  organizationId: z.string().min(1),
  enabled: z.boolean(),
  timeOfDay: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  weekdays: z.array(z.number().int().min(1).max(7)).min(1).max(7),
  timezone: z.string().trim().min(1).max(64),
  weekInReviewWeekday: z.number().int().min(1).max(7),
});

interface SaveStandupParameters extends AuthenticatedRequest {
  organizationId: string;
  enabled: boolean;
  timeOfDay: string;
  weekdays: number[];
  timezone: string;
  weekInReviewWeekday: number;
}

export const saveTeamStandup = withSession(
  async (params: SaveStandupParameters) => {
    const parsed = standupSchema.safeParse(params);
    if (!parsed.success)
      return toActionResult(err({ code: CommonErrorCode.BAD_INPUT }));
    try {
      const { organizationId, ...body } = parsed.data;
      return toActionResult(
        ok(await teamStandupService.update(organizationId, body)),
      );
    } catch (error) {
      return toActionResult(err(toCoreApiActionError(error)));
    }
  },
);
