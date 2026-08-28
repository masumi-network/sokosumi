"use server";

import { err, ok } from "neverthrow";
import { revalidatePath } from "next/cache";
import * as z from "zod";

import {
  type ActionResultDto,
  toActionResult,
} from "@/lib/actions/action-result";
import { type ActionError, CommonErrorCode } from "@/lib/actions/errors";
import { assertAdminSession } from "@/lib/auth/admin-access";
import { isAdminAccessRequiredError } from "@/lib/auth/errors";
import { toCoreApiActionError } from "@/lib/clients/core.client";
import type {
  AdminSokoBotDetail,
  AdminSokoBotList,
  SokoBotDeletionResult,
  SokoBotVersionDetail,
} from "@/lib/clients/generated/core";
import { adminSokoBotService } from "@/lib/services/admin-soko-bot.service";
import {
  ADMIN_SOKO_BOT_ACTIONS,
  ADMIN_SOKO_BOT_SCHEDULE_ACTIONS,
  ADMIN_SOKO_BOT_VERSIONS_ROUTE,
  ADMIN_SOKO_BOTS_ROUTE,
} from "@/lib/soko-bot/constants";
import {
  type AuthenticatedRequest,
  withSession,
} from "@/middleware/auth-middleware";

const performActionSchema = z
  .object({
    sokoBotId: z.string().trim().min(1),
    action: z.enum([
      ...ADMIN_SOKO_BOT_ACTIONS,
      ...ADMIN_SOKO_BOT_SCHEDULE_ACTIONS,
    ]),
    targetId: z.string().uuid().optional(),
    operationId: z.string().uuid(),
    reason: z.string().trim().min(3).max(500),
  })
  .superRefine((input, context) => {
    const needsTarget = ADMIN_SOKO_BOT_SCHEDULE_ACTIONS.includes(
      input.action as (typeof ADMIN_SOKO_BOT_SCHEDULE_ACTIONS)[number],
    );
    if (needsTarget && !input.targetId) {
      context.addIssue({
        code: "custom",
        path: ["targetId"],
        message: "Schedule action requires target",
      });
    }
  });

const listSchema = z.object({
  query: z.string().trim().max(200).optional(),
  limit: z.number().int().min(1).max(200).optional(),
});

const versionSlugSchema = z
  .string()
  .trim()
  .min(2)
  .max(41)
  .regex(/^[a-z0-9][a-z0-9-]*$/);

const versionWriteSchema = z.object({
  slug: versionSlugSchema,
  name: z.string().trim().min(1).max(120),
  summary: z.string().trim().max(2_000).default(""),
  model: z.string().trim().min(1).max(200),
  inferenceRegion: z.enum(["eu", "us"]).nullable().default(null),
  systemPrompt: z.string().min(1).max(60_000),
  skills: z.array(z.string().max(120)).max(50).default([]),
  capabilities: z.array(z.string().max(80)).max(60).default([]),
});

const versionUpdateSchema = versionWriteSchema.omit({ slug: true });

function mapError(error: unknown): ActionError {
  if (isAdminAccessRequiredError(error)) {
    return { code: CommonErrorCode.UNAUTHORIZED, message: error.message };
  }
  return toCoreApiActionError(error);
}

interface ListParams extends AuthenticatedRequest {
  query?: unknown;
  limit?: unknown;
}

export const listAdminSokoBotsAction = withSession<
  ListParams,
  ActionResultDto<AdminSokoBotList, ActionError>
>(async ({ session, query, limit }) => {
  try {
    assertAdminSession(session);
    const parsed = listSchema.safeParse({ query, limit });
    if (!parsed.success) {
      return toActionResult(
        err({ code: CommonErrorCode.BAD_INPUT, message: "Invalid input" }),
      );
    }
    return toActionResult(ok(await adminSokoBotService.list(parsed.data)));
  } catch (error) {
    return toActionResult(err(mapError(error)));
  }
});

interface PerformActionParams extends AuthenticatedRequest {
  input: unknown;
}

/** Audited operator action (pause/resume/reset/retry) with mandatory reason. */
export const performAdminSokoBotAction = withSession<
  PerformActionParams,
  ActionResultDto<AdminSokoBotDetail, ActionError>
>(async ({ session, input }) => {
  try {
    assertAdminSession(session);
    const parsed = performActionSchema.safeParse(input);
    if (!parsed.success) {
      return toActionResult(
        err({
          code: CommonErrorCode.BAD_INPUT,
          message: "Reason must be 3-500 characters and operation id valid",
        }),
      );
    }
    const detail = await adminSokoBotService.performAction(
      parsed.data.sokoBotId,
      {
        action: parsed.data.action,
        targetId: parsed.data.targetId,
        operationId: parsed.data.operationId,
        reason: parsed.data.reason,
      },
    );
    revalidatePath(ADMIN_SOKO_BOTS_ROUTE);
    revalidatePath(`${ADMIN_SOKO_BOTS_ROUTE}/${parsed.data.sokoBotId}`);
    return toActionResult(ok(detail));
  } catch (error) {
    return toActionResult(err(mapError(error)));
  }
});

interface DeleteBotParams extends AuthenticatedRequest {
  input: unknown;
}

const deleteBotSchema = z.object({ sokoBotId: z.string().uuid() });

export const deleteAdminSokoBotAction = withSession<
  DeleteBotParams,
  ActionResultDto<SokoBotDeletionResult, ActionError>
>(async ({ session, input }) => {
  try {
    assertAdminSession(session);
    const parsed = deleteBotSchema.safeParse(input);
    if (!parsed.success) {
      return toActionResult(
        err({
          code: CommonErrorCode.BAD_INPUT,
          message: "Invalid Soko Bot id",
        }),
      );
    }
    const result = await adminSokoBotService.deleteBot(parsed.data.sokoBotId);
    revalidatePath(ADMIN_SOKO_BOTS_ROUTE);
    return toActionResult(ok(result));
  } catch (error) {
    return toActionResult(err(mapError(error)));
  }
});

function revalidateVersionPaths(slug?: string): void {
  revalidatePath(ADMIN_SOKO_BOTS_ROUTE);
  revalidatePath(ADMIN_SOKO_BOT_VERSIONS_ROUTE);
  revalidatePath(`${ADMIN_SOKO_BOTS_ROUTE}/lab`);
  if (slug) revalidatePath(`${ADMIN_SOKO_BOT_VERSIONS_ROUTE}/${slug}`);
}

interface CreateVersionParams extends AuthenticatedRequest {
  input: unknown;
}

export const createAdminSokoBotVersionAction = withSession<
  CreateVersionParams,
  ActionResultDto<SokoBotVersionDetail, ActionError>
>(async ({ session, input }) => {
  try {
    assertAdminSession(session);
    const parsed = versionWriteSchema.safeParse(input);
    if (!parsed.success) {
      return toActionResult(
        err({ code: CommonErrorCode.BAD_INPUT, message: "Invalid input" }),
      );
    }
    const version = await adminSokoBotService.createVersion(parsed.data);
    revalidateVersionPaths(version.id);
    return toActionResult(ok(version));
  } catch (error) {
    return toActionResult(err(mapError(error)));
  }
});

interface UpdateVersionParams extends AuthenticatedRequest {
  slug: unknown;
  input: unknown;
}

export const updateAdminSokoBotVersionAction = withSession<
  UpdateVersionParams,
  ActionResultDto<SokoBotVersionDetail, ActionError>
>(async ({ session, slug, input }) => {
  try {
    assertAdminSession(session);
    const parsed = z
      .object({ slug: versionSlugSchema, input: versionUpdateSchema })
      .safeParse({ slug, input });
    if (!parsed.success) {
      return toActionResult(
        err({ code: CommonErrorCode.BAD_INPUT, message: "Invalid input" }),
      );
    }
    const version = await adminSokoBotService.updateVersion(
      parsed.data.slug,
      parsed.data.input,
    );
    revalidateVersionPaths(parsed.data.slug);
    return toActionResult(ok(version));
  } catch (error) {
    return toActionResult(err(mapError(error)));
  }
});

interface VersionSlugParams extends AuthenticatedRequest {
  slug: unknown;
}

export const archiveAdminSokoBotVersionAction = withSession<
  VersionSlugParams,
  ActionResultDto<void, ActionError>
>(async ({ session, slug }) => {
  try {
    assertAdminSession(session);
    const parsed = versionSlugSchema.safeParse(slug);
    if (!parsed.success) {
      return toActionResult(
        err({ code: CommonErrorCode.BAD_INPUT, message: "Invalid input" }),
      );
    }
    await adminSokoBotService.archiveVersion(parsed.data);
    revalidateVersionPaths(parsed.data);
    return toActionResult(ok(undefined));
  } catch (error) {
    return toActionResult(err(mapError(error)));
  }
});

export const promoteAdminSokoBotVersionAction = withSession<
  VersionSlugParams,
  ActionResultDto<{ defaultVersionId: string }, ActionError>
>(async ({ session, slug }) => {
  try {
    assertAdminSession(session);
    const parsed = versionSlugSchema.safeParse(slug);
    if (!parsed.success) {
      return toActionResult(
        err({ code: CommonErrorCode.BAD_INPUT, message: "Invalid input" }),
      );
    }
    const result = await adminSokoBotService.promoteVersion(parsed.data);
    revalidateVersionPaths(parsed.data);
    return toActionResult(ok(result));
  } catch (error) {
    return toActionResult(err(mapError(error)));
  }
});
