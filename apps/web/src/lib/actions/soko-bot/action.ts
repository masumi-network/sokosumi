"use server";

import { err, ok } from "neverthrow";
import { revalidatePath } from "next/cache";
import * as z from "zod";

import {
  type ActionResultDto,
  toActionResult,
} from "@/lib/actions/action-result";
import { type ActionError, CommonErrorCode } from "@/lib/actions/errors";
import {
  CoreApiRequestError,
  toCoreApiActionError,
} from "@/lib/clients/core.client";
import {
  type SokoBot,
  SokoBotAutonomyLevel,
  SokoBotAvatar,
  type SokoBotMemory,
  type SokoBotPendingDecision,
  type SokoBotSchedule,
  type StartSokoBotTurnResponse,
} from "@/lib/clients/generated/core";
import { sokoBotService } from "@/lib/services/soko-bot.service";
import {
  SOKO_BOT_BUSY_ERROR_CODE,
  SOKO_BOT_ROUTE,
} from "@/lib/soko-bot/constants";
import {
  type AuthenticatedRequest,
  withSession,
} from "@/middleware/auth-middleware";

const autonomySchema = z.enum([
  SokoBotAutonomyLevel.SUPERVISED,
  SokoBotAutonomyLevel.AUTONOMOUS,
]);

const createSokoBotSchema = z.object({
  name: z.string().trim().min(1).max(80),
  autonomyLevel: autonomySchema,
  avatarId: z.string().uuid().nullable().optional(),
});

const avatarListSchema = z.object({
  take: z.number().int().min(1).max(12).default(6),
  excludeIds: z.array(z.string().uuid()).max(60).default([]),
});

const startTurnSchema = z.object({
  clientTurnId: z.string().trim().min(1).max(128),
  message: z.string().trim().min(1).max(8000),
});

const scheduleSchema = z.object({
  name: z.string().trim().min(1).max(120),
  timezone: z.string().trim().min(1).max(64),
  cronExpression: z.string().trim().min(1).max(64),
  prompt: z.string().trim().min(1).max(4000),
});

const updateScheduleSchema = z.object({
  scheduleId: z.string().trim().min(1),
  patch: scheduleSchema.partial().extend({ enabled: z.boolean().optional() }),
});

const idSchema = z.string().trim().min(1);

function invalidInput(): ActionError {
  return { code: CommonErrorCode.BAD_INPUT, message: "Invalid input" };
}

function mapTurnError(error: unknown): ActionError {
  if (error instanceof CoreApiRequestError && error.status === 409) {
    return { code: SOKO_BOT_BUSY_ERROR_CODE, message: error.message };
  }
  return toCoreApiActionError(error);
}

function revalidate() {
  revalidatePath(SOKO_BOT_ROUTE);
}

interface CreateSokoBotParams extends AuthenticatedRequest {
  input: unknown;
}

/** Create the user's Soko Bot, or reactivate an archived one. */
export const createSokoBotAction = withSession<
  CreateSokoBotParams,
  ActionResultDto<SokoBot, ActionError>
>(async ({ input }) => {
  const parsed = createSokoBotSchema.safeParse(input);
  if (!parsed.success) return toActionResult(err(invalidInput()));
  try {
    const bot = await sokoBotService.createOrUpdate(parsed.data);
    revalidate();
    return toActionResult(ok(bot));
  } catch (error) {
    return toActionResult(err(toCoreApiActionError(error)));
  }
});

interface UpdateAutonomyParams extends AuthenticatedRequest {
  autonomyLevel: unknown;
}

export const updateSokoBotAutonomyAction = withSession<
  UpdateAutonomyParams,
  ActionResultDto<SokoBot, ActionError>
>(async ({ autonomyLevel }) => {
  const parsed = autonomySchema.safeParse(autonomyLevel);
  if (!parsed.success) return toActionResult(err(invalidInput()));
  try {
    const current = await sokoBotService.getMine();
    if (!current) {
      return toActionResult(
        err({ code: CommonErrorCode.NOT_FOUND, message: "No Soko Bot" }),
      );
    }
    const bot = await sokoBotService.updateAutonomy(current, parsed.data);
    revalidate();
    return toActionResult(ok(bot));
  } catch (error) {
    return toActionResult(err(toCoreApiActionError(error)));
  }
});

export const archiveSokoBotAction = withSession<
  AuthenticatedRequest,
  ActionResultDto<void, ActionError>
>(async () => {
  try {
    await sokoBotService.archive();
    revalidate();
    return toActionResult(ok());
  } catch (error) {
    return toActionResult(err(toCoreApiActionError(error)));
  }
});

interface StartTurnParams extends AuthenticatedRequest {
  input: unknown;
}

export const startSokoBotTurnAction = withSession<
  StartTurnParams,
  ActionResultDto<StartSokoBotTurnResponse, ActionError>
>(async ({ input }) => {
  const parsed = startTurnSchema.safeParse(input);
  if (!parsed.success) return toActionResult(err(invalidInput()));
  try {
    const result = await sokoBotService.startTurn(parsed.data);
    revalidate();
    return toActionResult(ok(result));
  } catch (error) {
    return toActionResult(err(mapTurnError(error)));
  }
});

interface TurnIdParams extends AuthenticatedRequest {
  turnId: unknown;
}

export const cancelSokoBotTurnAction = withSession<
  TurnIdParams,
  ActionResultDto<void, ActionError>
>(async ({ turnId }) => {
  const parsed = idSchema.safeParse(turnId);
  if (!parsed.success) return toActionResult(err(invalidInput()));
  try {
    await sokoBotService.cancelTurn(parsed.data);
    revalidate();
    return toActionResult(ok());
  } catch (error) {
    return toActionResult(err(toCoreApiActionError(error)));
  }
});

export const resetSokoBotMemoryAction = withSession<
  AuthenticatedRequest,
  ActionResultDto<SokoBotMemory, ActionError>
>(async () => {
  try {
    const memory = await sokoBotService.resetMemory();
    revalidate();
    return toActionResult(ok(memory));
  } catch (error) {
    return toActionResult(err(toCoreApiActionError(error)));
  }
});

interface CreateScheduleParams extends AuthenticatedRequest {
  input: unknown;
}

export const createSokoBotScheduleAction = withSession<
  CreateScheduleParams,
  ActionResultDto<SokoBotSchedule, ActionError>
>(async ({ input }) => {
  const parsed = scheduleSchema.safeParse(input);
  if (!parsed.success) return toActionResult(err(invalidInput()));
  try {
    const schedule = await sokoBotService.createSchedule(parsed.data);
    revalidate();
    return toActionResult(ok(schedule));
  } catch (error) {
    return toActionResult(err(toCoreApiActionError(error)));
  }
});

interface UpdateScheduleParams extends AuthenticatedRequest {
  input: unknown;
}

export const updateSokoBotScheduleAction = withSession<
  UpdateScheduleParams,
  ActionResultDto<SokoBotSchedule, ActionError>
>(async ({ input }) => {
  const parsed = updateScheduleSchema.safeParse(input);
  if (!parsed.success) return toActionResult(err(invalidInput()));
  try {
    const schedule = await sokoBotService.updateSchedule(
      parsed.data.scheduleId,
      parsed.data.patch,
    );
    revalidate();
    return toActionResult(ok(schedule));
  } catch (error) {
    return toActionResult(err(toCoreApiActionError(error)));
  }
});

interface ScheduleIdParams extends AuthenticatedRequest {
  scheduleId: unknown;
}

export const deleteSokoBotScheduleAction = withSession<
  ScheduleIdParams,
  ActionResultDto<void, ActionError>
>(async ({ scheduleId }) => {
  const parsed = idSchema.safeParse(scheduleId);
  if (!parsed.success) return toActionResult(err(invalidInput()));
  try {
    await sokoBotService.deleteSchedule(parsed.data);
    revalidate();
    return toActionResult(ok());
  } catch (error) {
    return toActionResult(err(toCoreApiActionError(error)));
  }
});

interface ResolveDecisionParams extends AuthenticatedRequest {
  decisionId: unknown;
  resolution: unknown;
}

const resolutionSchema = z.enum(["ACCEPT", "REJECT"]);

export const resolveSokoBotDecisionAction = withSession<
  ResolveDecisionParams,
  ActionResultDto<SokoBotPendingDecision, ActionError>
>(async ({ decisionId, resolution }) => {
  const parsedId = idSchema.safeParse(decisionId);
  const parsedResolution = resolutionSchema.safeParse(resolution);
  if (!parsedId.success || !parsedResolution.success) {
    return toActionResult(err(invalidInput()));
  }
  try {
    const decision = await sokoBotService.resolveDecision(parsedId.data, {
      resolution: parsedResolution.data,
    });
    revalidate();
    return toActionResult(ok(decision));
  } catch (error) {
    return toActionResult(err(toCoreApiActionError(error)));
  }
});

interface ListAvatarsParams extends AuthenticatedRequest {
  input: unknown;
}

/** Unclaimed mascot avatars for the picker; pass shown ids to get a fresh set. */
export const listSokoBotAvatarsAction = withSession<
  ListAvatarsParams,
  ActionResultDto<SokoBotAvatar[], ActionError>
>(async ({ input }) => {
  const parsed = avatarListSchema.safeParse(input ?? {});
  if (!parsed.success) return toActionResult(err(invalidInput()));
  try {
    const avatars = await sokoBotService.listAvatars(
      parsed.data.take,
      parsed.data.excludeIds,
    );
    return toActionResult(ok(avatars));
  } catch (error) {
    return toActionResult(err(toCoreApiActionError(error)));
  }
});

interface ClaimAvatarParams extends AuthenticatedRequest {
  avatarId: unknown;
}

export const claimSokoBotAvatarAction = withSession<
  ClaimAvatarParams,
  ActionResultDto<SokoBot, ActionError>
>(async ({ avatarId }) => {
  const parsed = idSchema.safeParse(avatarId);
  if (!parsed.success) return toActionResult(err(invalidInput()));
  try {
    const bot = await sokoBotService.claimAvatar(parsed.data);
    revalidate();
    return toActionResult(ok(bot));
  } catch (error) {
    return toActionResult(err(toCoreApiActionError(error)));
  }
});
