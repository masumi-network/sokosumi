"use server";

import type { SokoBotIntegrationCatalogEntry } from "@sokosumi/core-client";
import {
  type InstallSokoBotSkillResponse,
  type SokoBot,
  SokoBotAvatar,
  type SokoBotDeletionResult,
  type SokoBotLabRun,
  type SokoBotLabTaskEvent,
  type SokoBotLabVerdict,
  type SokoBotMemory,
  type SokoBotPendingDecision,
  type SokoBotSchedule,
  SokoBotScope,
  type SokoBotSkillBrowse,
  type SokoBotSkillSearchResult,
  type StartSokoBotTurnResponse,
} from "@sokosumi/core-client";
import { err, ok } from "neverthrow";
import { revalidatePath } from "next/cache";
import * as z from "zod";
import {
  type ActionResultDto,
  toActionResult,
} from "@/lib/actions/action-result";
import type { ActionError } from "@/lib/actions/errors/action-error";
import { CommonErrorCode } from "@/lib/actions/errors/error-codes/common";
import {
  CoreApiRequestError,
  toCoreApiActionError,
} from "@/lib/clients/core.client";
import { sokoBotService } from "@/lib/services/soko-bot.service";
import {
  SOKO_BOT_AVATAR_RATE_LIMITED_ERROR_CODE,
  SOKO_BOT_BUSY_ERROR_CODE,
  SOKO_BOTS_ROUTE,
  sokoBotConsoleRoute,
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
  take: z.number().int().min(1).max(6).default(6),
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

/** A shared bot's id; absent means the caller's own bot. */
const botIdSchema = z.string().uuid().optional();

const createScopedSokoBotSchema = createSokoBotSchema
  .extend({
    scope: z.enum(SokoBotScope),
    projectId: z.string().uuid().nullable().optional(),
    timezone: z.string().trim().min(1).max(64).optional(),
  })
  .refine(
    (input) =>
      (input.scope === SokoBotScope.PROJECT) === Boolean(input.projectId),
  );

/** Every action that can act on a shared bot takes its id as `botId`. */
interface BotScopedParams extends AuthenticatedRequest {
  botId?: unknown;
}

function invalidInput(): ActionError {
  return { code: CommonErrorCode.BAD_INPUT, message: "Invalid input" };
}

// A spent hourly allowance is a wait, not a breakage. Give the picker its own
// code so it can say so instead of showing the generic load failure.
function mapAvatarTopUpError(error: unknown): ActionError {
  if (error instanceof CoreApiRequestError && error.status === 429) {
    return {
      code: SOKO_BOT_AVATAR_RATE_LIMITED_ERROR_CODE,
      message: error.message,
    };
  }
  return toCoreApiActionError(error);
}

function mapTurnError(error: unknown): ActionError {
  if (error instanceof CoreApiRequestError && error.status === 409) {
    return { code: SOKO_BOT_BUSY_ERROR_CODE, message: error.message };
  }
  return toCoreApiActionError(error);
}

function revalidate(botId?: string) {
  revalidatePath(sokoBotConsoleRoute(botId));
  // The roster lists shared bots, so a change to one shows there too.
  if (botId) revalidatePath(SOKO_BOTS_ROUTE);
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

/** Create a personal, project or workspace bot from the roster. */
export const createScopedSokoBotAction = withSession<
  CreateSokoBotParams,
  ActionResultDto<SokoBot, ActionError>
>(async ({ input }) => {
  const parsed = createScopedSokoBotSchema.safeParse(input);
  if (!parsed.success) return toActionResult(err(invalidInput()));
  try {
    const bot = await sokoBotService.createScoped(parsed.data);
    revalidatePath(SOKO_BOTS_ROUTE);
    return toActionResult(ok(bot));
  } catch (error) {
    return toActionResult(err(toCoreApiActionError(error)));
  }
});

export const archiveSokoBotAction = withSession<
  BotScopedParams,
  ActionResultDto<void, ActionError>
>(async ({ botId }) => {
  const parsedBot = botIdSchema.safeParse(botId);
  if (!parsedBot.success) return toActionResult(err(invalidInput()));
  try {
    await sokoBotService.archive(parsedBot.data);
    revalidate(parsedBot.data);
    return toActionResult(ok());
  } catch (error) {
    return toActionResult(err(toCoreApiActionError(error)));
  }
});

export const reactivateSokoBotAction = withSession<
  AuthenticatedRequest & { botId: unknown },
  ActionResultDto<void, ActionError>
>(async ({ botId }) => {
  const parsedBot = z.string().uuid().safeParse(botId);
  if (!parsedBot.success) return toActionResult(err(invalidInput()));
  try {
    await sokoBotService.reactivate(parsedBot.data);
    revalidate(parsedBot.data);
    return toActionResult(ok());
  } catch (error) {
    return toActionResult(err(toCoreApiActionError(error)));
  }
});

export const deleteSokoBotAction = withSession<
  BotScopedParams,
  ActionResultDto<SokoBotDeletionResult, ActionError>
>(async ({ botId }) => {
  const parsedBot = botIdSchema.safeParse(botId);
  if (!parsedBot.success) return toActionResult(err(invalidInput()));
  try {
    const result = await sokoBotService.deletePermanently(parsedBot.data);
    revalidate(parsedBot.data);
    return toActionResult(ok(result));
  } catch (error) {
    return toActionResult(err(toCoreApiActionError(error)));
  }
});

interface StartTurnParams extends BotScopedParams {
  input: unknown;
}

export const startSokoBotTurnAction = withSession<
  StartTurnParams,
  ActionResultDto<StartSokoBotTurnResponse, ActionError>
>(async ({ input, botId }) => {
  const parsed = startTurnSchema.safeParse(input);
  const parsedBot = botIdSchema.safeParse(botId);
  if (!parsed.success || !parsedBot.success)
    return toActionResult(err(invalidInput()));
  try {
    const result = await sokoBotService.startTurn(parsed.data, parsedBot.data);
    revalidate(parsedBot.data);
    return toActionResult(ok(result));
  } catch (error) {
    return toActionResult(err(mapTurnError(error)));
  }
});

export const resetSokoBotMemoryAction = withSession<
  BotScopedParams,
  ActionResultDto<SokoBotMemory, ActionError>
>(async ({ botId }) => {
  const parsedBot = botIdSchema.safeParse(botId);
  if (!parsedBot.success) return toActionResult(err(invalidInput()));
  try {
    const memory = await sokoBotService.resetMemory(parsedBot.data);
    revalidate(parsedBot.data);
    return toActionResult(ok(memory));
  } catch (error) {
    return toActionResult(err(toCoreApiActionError(error)));
  }
});

interface CreateScheduleParams extends BotScopedParams {
  input: unknown;
}

export const createSokoBotScheduleAction = withSession<
  CreateScheduleParams,
  ActionResultDto<SokoBotSchedule, ActionError>
>(async ({ input, botId }) => {
  const parsed = scheduleSchema.safeParse(input);
  const parsedBot = botIdSchema.safeParse(botId);
  if (!parsed.success || !parsedBot.success)
    return toActionResult(err(invalidInput()));
  try {
    const schedule = await sokoBotService.createSchedule(
      parsed.data,
      parsedBot.data,
    );
    revalidate(parsedBot.data);
    return toActionResult(ok(schedule));
  } catch (error) {
    return toActionResult(err(toCoreApiActionError(error)));
  }
});

interface UpdateScheduleParams extends BotScopedParams {
  input: unknown;
}

export const updateSokoBotScheduleAction = withSession<
  UpdateScheduleParams,
  ActionResultDto<SokoBotSchedule, ActionError>
>(async ({ input, botId }) => {
  const parsed = updateScheduleSchema.safeParse(input);
  const parsedBot = botIdSchema.safeParse(botId);
  if (!parsed.success || !parsedBot.success)
    return toActionResult(err(invalidInput()));
  try {
    const schedule = await sokoBotService.updateSchedule(
      parsed.data.scheduleId,
      parsed.data.patch,
      parsedBot.data,
    );
    revalidate(parsedBot.data);
    return toActionResult(ok(schedule));
  } catch (error) {
    return toActionResult(err(toCoreApiActionError(error)));
  }
});

interface ScheduleIdParams extends BotScopedParams {
  scheduleId: unknown;
}

export const deleteSokoBotScheduleAction = withSession<
  ScheduleIdParams,
  ActionResultDto<void, ActionError>
>(async ({ scheduleId, botId }) => {
  const parsed = idSchema.safeParse(scheduleId);
  const parsedBot = botIdSchema.safeParse(botId);
  if (!parsed.success || !parsedBot.success)
    return toActionResult(err(invalidInput()));
  try {
    await sokoBotService.deleteSchedule(parsed.data, parsedBot.data);
    revalidate(parsedBot.data);
    return toActionResult(ok());
  } catch (error) {
    return toActionResult(err(toCoreApiActionError(error)));
  }
});

interface ResolveDecisionParams extends BotScopedParams {
  decisionId: unknown;
  resolution: unknown;
}

const resolutionSchema = z.enum(["ACCEPT", "REJECT"]);

export const resolveSokoBotDecisionAction = withSession<
  ResolveDecisionParams,
  ActionResultDto<SokoBotPendingDecision, ActionError>
>(async ({ decisionId, resolution, botId }) => {
  const parsedId = idSchema.safeParse(decisionId);
  const parsedResolution = resolutionSchema.safeParse(resolution);
  const parsedBot = botIdSchema.safeParse(botId);
  if (!parsedId.success || !parsedResolution.success || !parsedBot.success) {
    return toActionResult(err(invalidInput()));
  }
  try {
    const decision = await sokoBotService.resolveDecision(
      parsedId.data,
      { resolution: parsedResolution.data },
      parsedBot.data,
    );
    revalidate(parsedBot.data);
    return toActionResult(ok(decision));
  } catch (error) {
    return toActionResult(err(toCoreApiActionError(error)));
  }
});

interface ListAvatarsParams extends AuthenticatedRequest {
  input: unknown;
}

/**
 * Unclaimed mascot avatars for the picker; pass shown ids to get a fresh set.
 * This generates missing mascots first, so it bills FAL and writes rows. Named
 * for that rather than for the list it returns.
 */
export const topUpSokoBotAvatarsAction = withSession<
  ListAvatarsParams,
  ActionResultDto<SokoBotAvatar[], ActionError>
>(async ({ input }) => {
  const parsed = avatarListSchema.safeParse(input ?? {});
  if (!parsed.success) return toActionResult(err(invalidInput()));
  try {
    const avatars = await sokoBotService.topUpAvatars(
      parsed.data.take,
      parsed.data.excludeIds,
    );
    return toActionResult(ok(avatars));
  } catch (error) {
    return toActionResult(err(mapAvatarTopUpError(error)));
  }
});

interface ClaimAvatarParams extends AuthenticatedRequest {
  avatarId: unknown;
}

interface SetVersionParams extends AuthenticatedRequest {
  versionId: unknown;
}

const proactiveSchema = z
  .object({
    paused: z.boolean().optional(),
    dailyLimit: z.number().int().min(1).max(200).optional(),
    timezone: z.string().trim().min(1).max(64).optional(),
    mailAutoRead: z.boolean().optional(),
  })
  .strict();

export const updateSokoBotProactiveAction = withSession<
  BotScopedParams & { input: unknown },
  ActionResultDto<SokoBot, ActionError>
>(async ({ input, botId }) => {
  const parsed = proactiveSchema.safeParse(input);
  const parsedBot = botIdSchema.safeParse(botId);
  if (!parsed.success || !parsedBot.success)
    return toActionResult(err(invalidInput()));
  try {
    const bot = await sokoBotService.updateProactive(
      parsed.data,
      parsedBot.data,
    );
    revalidate(parsedBot.data);
    return toActionResult(ok(bot));
  } catch (error) {
    return toActionResult(err(toCoreApiActionError(error)));
  }
});

export const sendSokoBotTurnFeedbackAction = withSession<
  AuthenticatedRequest & { turnId: unknown; useful: unknown },
  ActionResultDto<{ useful: boolean }, ActionError>
>(async ({ turnId, useful }) => {
  const parsedId = z.string().uuid().safeParse(turnId);
  const parsedUseful = z.boolean().safeParse(useful);
  if (!parsedId.success || !parsedUseful.success)
    return toActionResult(err(invalidInput()));
  try {
    await sokoBotService.sendTurnFeedback(parsedId.data, parsedUseful.data);
    return toActionResult(ok({ useful: parsedUseful.data }));
  } catch (error) {
    return toActionResult(err(toCoreApiActionError(error)));
  }
});

export const setSokoBotFollowBoardAction = withSession<
  BotScopedParams & { enabled: unknown },
  ActionResultDto<SokoBot, ActionError>
>(async ({ enabled, botId }) => {
  const parsed = z.boolean().safeParse(enabled);
  const parsedBot = botIdSchema.safeParse(botId);
  if (!parsed.success || !parsedBot.success)
    return toActionResult(err(invalidInput()));
  try {
    const bot = await sokoBotService.setFollowBoard(
      parsed.data,
      parsedBot.data,
    );
    revalidate(parsedBot.data);
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

const labIngestSchema = z.object({
  beat: z.enum(["standup", "weekly-wrap", "delta"]),
});

/** Behaviour lab only: run one proactive rhythm now. */
export const runSokoBotLabIngestAction = withSession<
  SimulateTaskEventParams,
  ActionResultDto<{ turnId: string }, ActionError>
>(async ({ input }) => {
  const parsed = labIngestSchema.safeParse(input);
  if (!parsed.success) return toActionResult(err(invalidInput()));
  try {
    return toActionResult(
      ok({ turnId: await sokoBotService.runLabIngest(parsed.data.beat) }),
    );
  } catch (error) {
    return toActionResult(err(toCoreApiActionError(error)));
  }
});

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

interface IntegrationParams extends BotScopedParams {
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
>(async ({ provider, returnUrl, botId }) => {
  const parsed = providerSchema.safeParse(provider);
  const parsedUrl = z.string().url().safeParse(returnUrl);
  const parsedBot = botIdSchema.safeParse(botId);
  if (!parsed.success || !parsedUrl.success || !parsedBot.success)
    return toActionResult(err(invalidInput()));
  try {
    return toActionResult(
      ok(
        await sokoBotService.connectIntegration(
          parsed.data,
          parsedUrl.data,
          parsedBot.data,
        ),
      ),
    );
  } catch (error) {
    return toActionResult(err(toCoreApiActionError(error)));
  }
});

export const disconnectSokoBotIntegrationAction = withSession<
  IntegrationParams,
  ActionResultDto<{ disconnected: true }, ActionError>
>(async ({ provider, botId }) => {
  const parsed = providerSchema.safeParse(provider);
  const parsedBot = botIdSchema.safeParse(botId);
  if (!parsed.success || !parsedBot.success)
    return toActionResult(err(invalidInput()));
  try {
    await sokoBotService.disconnectIntegration(parsed.data, parsedBot.data);
    revalidate(parsedBot.data);
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
