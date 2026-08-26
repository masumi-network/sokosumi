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
import type { SokoBotIntegrationCatalogEntry } from "@/lib/clients/generated/core";
import {
  type InstallSokoBotSkillResponse,
  type SokoBot,
  SokoBotAvatar,
  type SokoBotLabRun,
  type SokoBotLabTaskEvent,
  type SokoBotLabVerdict,
  type SokoBotMemory,
  type SokoBotPendingDecision,
  type SokoBotSchedule,
  type SokoBotSkillBrowse,
  type SokoBotSkillSearchResult,
  type SokoBotVersion,
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

const createSokoBotSchema = z.object({
  name: z.string().trim().min(1).max(80),
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

export const listSokoBotVersionsAction = withSession<
  AuthenticatedRequest,
  ActionResultDto<SokoBotVersion[], ActionError>
>(async () => {
  try {
    return toActionResult(ok(await sokoBotService.listVersions()));
  } catch (error) {
    return toActionResult(err(toCoreApiActionError(error)));
  }
});

interface SetVersionParams extends AuthenticatedRequest {
  versionId: unknown;
}

export const setSokoBotFollowBoardAction = withSession<
  AuthenticatedRequest & { enabled: unknown },
  ActionResultDto<SokoBot, ActionError>
>(async ({ enabled }) => {
  const parsed = z.boolean().safeParse(enabled);
  if (!parsed.success) return toActionResult(err(invalidInput()));
  try {
    const bot = await sokoBotService.setFollowBoard(parsed.data);
    revalidate();
    return toActionResult(ok(bot));
  } catch (error) {
    return toActionResult(err(toCoreApiActionError(error)));
  }
});

export const setSokoBotVersionAction = withSession<
  SetVersionParams,
  ActionResultDto<SokoBot, ActionError>
>(async ({ versionId }) => {
  const parsed = z.string().min(1).max(64).safeParse(versionId);
  if (!parsed.success) return toActionResult(err(invalidInput()));
  try {
    const bot = await sokoBotService.setVersion(parsed.data);
    revalidate();
    return toActionResult(ok(bot));
  } catch (error) {
    return toActionResult(err(toCoreApiActionError(error)));
  }
});

interface InstallSkillParams extends AuthenticatedRequest {
  input: unknown;
}

const installSkillSchema = z.object({
  source: z.string().trim().min(3).max(300),
  skillName: z.string().trim().min(1).max(120).nullable().optional(),
});

export const installSokoBotSkillAction = withSession<
  InstallSkillParams,
  ActionResultDto<InstallSokoBotSkillResponse, ActionError>
>(async ({ input }) => {
  const parsed = installSkillSchema.safeParse(input);
  if (!parsed.success) return toActionResult(err(invalidInput()));
  try {
    const result = await sokoBotService.installSkill(parsed.data);
    revalidate();
    return toActionResult(ok(result));
  } catch (error) {
    return toActionResult(err(toCoreApiActionError(error)));
  }
});

interface RemoveSkillParams extends AuthenticatedRequest {
  skillId: unknown;
}

export const removeSokoBotSkillAction = withSession<
  RemoveSkillParams,
  ActionResultDto<void, ActionError>
>(async ({ skillId }) => {
  const parsed = z.string().uuid().safeParse(skillId);
  if (!parsed.success) return toActionResult(err(invalidInput()));
  try {
    await sokoBotService.removeSkill(parsed.data);
    revalidate();
    return toActionResult(ok());
  } catch (error) {
    return toActionResult(err(toCoreApiActionError(error)));
  }
});

interface BrowseSkillsParams extends AuthenticatedRequest {
  page: unknown;
}

export const browseSokoBotSkillsAction = withSession<
  BrowseSkillsParams,
  ActionResultDto<SokoBotSkillBrowse, ActionError>
>(async ({ page }) => {
  const parsed = z.number().int().min(0).max(50).safeParse(page);
  if (!parsed.success) return toActionResult(err(invalidInput()));
  try {
    return toActionResult(ok(await sokoBotService.browseSkills(parsed.data)));
  } catch (error) {
    return toActionResult(err(toCoreApiActionError(error)));
  }
});

interface SearchSkillsParams extends AuthenticatedRequest {
  q: unknown;
}

export const searchSokoBotSkillsAction = withSession<
  SearchSkillsParams,
  ActionResultDto<SokoBotSkillSearchResult[], ActionError>
>(async ({ q }) => {
  const parsed = z.string().trim().min(1).max(100).safeParse(q);
  if (!parsed.success) return toActionResult(err(invalidInput()));
  try {
    return toActionResult(ok(await sokoBotService.searchSkills(parsed.data)));
  } catch (error) {
    return toActionResult(err(toCoreApiActionError(error)));
  }
});

interface ListLabRunsParams extends AuthenticatedRequest {
  versionId?: unknown;
}

export const listSokoBotLabRunsAction = withSession<
  ListLabRunsParams,
  ActionResultDto<SokoBotLabRun[], ActionError>
>(async ({ versionId }) => {
  const parsed = z.string().min(1).max(64).optional().safeParse(versionId);
  if (!parsed.success) return toActionResult(err(invalidInput()));
  try {
    return toActionResult(ok(await sokoBotService.listLabRuns(parsed.data)));
  } catch (error) {
    return toActionResult(err(toCoreApiActionError(error)));
  }
});

const judgeLabTurnSchema = z.object({
  turnId: z.string().uuid(),
  scenarioId: z.string().min(1).max(80),
  evaluation: z
    .object({
      passed: z.number().int().min(0),
      total: z.number().int().min(0),
      checks: z.array(
        z.object({ label: z.string(), pass: z.boolean(), actual: z.string() }),
      ),
    })
    .optional(),
});

interface JudgeLabTurnParams extends AuthenticatedRequest {
  input: unknown;
}

export const judgeSokoBotLabTurnAction = withSession<
  JudgeLabTurnParams,
  ActionResultDto<SokoBotLabVerdict, ActionError>
>(async ({ input }) => {
  const parsed = judgeLabTurnSchema.safeParse(input);
  if (!parsed.success) return toActionResult(err(invalidInput()));
  try {
    return toActionResult(ok(await sokoBotService.judgeLabTurn(parsed.data)));
  } catch (error) {
    return toActionResult(err(toCoreApiActionError(error)));
  }
});

const simulateTaskEventSchema = z.object({
  taskId: z.string().uuid().optional(),
  status: z.enum(["INPUT_REQUIRED", "FAILED", "COMPLETED"]),
  comment: z.string().trim().min(1).max(4000),
});

interface SimulateTaskEventParams extends AuthenticatedRequest {
  input: unknown;
}

/** Behaviour lab only: pretend a Coworker moved a delegated Task. */
export const simulateSokoBotTaskEventAction = withSession<
  SimulateTaskEventParams,
  ActionResultDto<SokoBotLabTaskEvent, ActionError>
>(async ({ input }) => {
  const parsed = simulateTaskEventSchema.safeParse(input);
  if (!parsed.success) return toActionResult(err(invalidInput()));
  try {
    return toActionResult(
      ok(await sokoBotService.simulateTaskEvent(parsed.data)),
    );
  } catch (error) {
    return toActionResult(err(toCoreApiActionError(error)));
  }
});

interface IntegrationParams extends AuthenticatedRequest {
  provider: unknown;
}

const providerSchema = z
  .string()
  .trim()
  .regex(/^[a-z0-9_-]{1,40}$/);

export const searchSokoBotIntegrationCatalogAction = withSession<
  AuthenticatedRequest & { query: unknown },
  ActionResultDto<SokoBotIntegrationCatalogEntry[], ActionError>
>(async ({ query }) => {
  const parsed = z
    .string()
    .trim()
    .max(100)
    .safeParse(query ?? "");
  if (!parsed.success) return toActionResult(err(invalidInput()));
  try {
    return toActionResult(
      ok(await sokoBotService.searchIntegrationCatalog(parsed.data)),
    );
  } catch (error) {
    return toActionResult(err(toCoreApiActionError(error)));
  }
});

export const connectSokoBotIntegrationAction = withSession<
  IntegrationParams & { returnUrl: unknown },
  ActionResultDto<{ redirectUrl: string }, ActionError>
>(async ({ provider, returnUrl }) => {
  const parsed = providerSchema.safeParse(provider);
  const parsedUrl = z.string().url().safeParse(returnUrl);
  if (!parsed.success || !parsedUrl.success)
    return toActionResult(err(invalidInput()));
  try {
    return toActionResult(
      ok(await sokoBotService.connectIntegration(parsed.data, parsedUrl.data)),
    );
  } catch (error) {
    return toActionResult(err(toCoreApiActionError(error)));
  }
});

export const disconnectSokoBotIntegrationAction = withSession<
  IntegrationParams,
  ActionResultDto<{ disconnected: true }, ActionError>
>(async ({ provider }) => {
  const parsed = providerSchema.safeParse(provider);
  if (!parsed.success) return toActionResult(err(invalidInput()));
  try {
    await sokoBotService.disconnectIntegration(parsed.data);
    revalidate();
    return toActionResult(ok({ disconnected: true as const }));
  } catch (error) {
    return toActionResult(err(toCoreApiActionError(error)));
  }
});

interface IntroduceParams extends AuthenticatedRequest {
  roomId: unknown;
}

export const introduceSokoBotAction = withSession<
  IntroduceParams,
  ActionResultDto<{ messageId: string }, ActionError>
>(async ({ roomId }) => {
  const parsed = idSchema.safeParse(roomId);
  if (!parsed.success) return toActionResult(err(invalidInput()));
  try {
    return toActionResult(ok(await sokoBotService.introduce(parsed.data)));
  } catch (error) {
    return toActionResult(err(toCoreApiActionError(error)));
  }
});

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
