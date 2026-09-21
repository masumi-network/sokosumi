import { ComposioError } from "@composio/core";
import { z } from "@hono/zod-openapi";
import { isNmkrEmail } from "@sokosumi/utils";
import type { Context, Next } from "hono";
import { getEnv } from "@/config/env";
import {
  conflict,
  forbidden,
  notFound,
  serviceUnavailable,
  unprocessableEntity,
} from "@/helpers/error";
import prisma from "@/lib/db/prisma";
import type { EnvVariables } from "@/lib/hono";
import { isSokoBotAuthContext, isUserAuthContext } from "@/middleware/auth";
import { cursorPaginationQuerySchema } from "@/schemas/pagination.schema";
import { getSokoBotAvailability } from "@/services/soko-bot-availability.service";
import { SokoBotBillingAccessError } from "@/services/soko-bot-billing.service";
import {
  SokoBotBusyError,
  SokoBotIdempotencyConflictError,
  SokoBotNotFoundError,
  SokoBotRetryableStartError,
  SokoBotStartAbortedError,
  SokoBotValidationError,
  sokoBotControlPlane,
} from "@/services/soko-bot-control-plane.service";
import { SokoBotIntegrationError } from "@/services/soko-bot-integrations.service";
import {
  SokoBotRuntimeAuthorizationError,
  SokoBotRuntimeConflictError,
  SokoBotRuntimeValidationError,
} from "@/services/soko-bot-runtime.service";

export const sokoBotPaginationQuerySchema = cursorPaginationQuerySchema.extend({
  cursor: z.string().uuid().optional(),
});

export const turnParams = z.object({
  turnId: z
    .string()
    .uuid()
    .openapi({ param: { name: "turnId", in: "path" } }),
});

export const scheduleParams = z.object({
  scheduleId: z
    .string()
    .uuid()
    .openapi({ param: { name: "scheduleId", in: "path" } }),
});

export const decisionParams = z.object({
  decisionId: z
    .string()
    .uuid()
    .openapi({ param: { name: "decisionId", in: "path" } }),
});

export const providerParamSchema = z.object({ provider: z.string().min(1) });

/**
 * Kill switch + beta gate. Lives on the router so a new endpoint cannot
 * be added outside it.
 */
export async function sokoBotRouteGate(
  c: Context<EnvVariables>,
  next: Next,
): Promise<void> {
  if (!getEnv().SOKO_BOT_ENABLED) throw notFound("Soko Bot is not enabled");
  // 503 rather than 404: the feature exists and is coming back, and the
  // console tells the owner that rather than pretending it was never there.
  const availability = await getSokoBotAvailability();
  if (availability.disabled) {
    throw serviceUnavailable(
      availability.disabledReason ??
        "Soko Bot is temporarily disabled by an administrator",
      {
        kind: "soko-bot-disabled",
        reportToSentry: false,
      },
    );
  }
  // Beta gate, matching the web route's 404 and the calendar routes' rule.
  // It lives on the router rather than per handler so a new endpoint cannot
  // be added outside it; the UI gate alone would leave the API open.
  // Fail closed: every handler here requires a user actor today, and an
  // endpoint added later for a coworker key must not slip past the beta by
  // simply not being a user.
  const auth = c.var.authContext;
  if (isSokoBotAuthContext(auth)) {
    await next();
    return;
  }
  if (!isUserAuthContext(auth)) {
    throw notFound("Soko Bot is not enabled");
  }
  const user = await prisma.user.findUnique({
    where: { id: auth.userId },
    select: { email: true, emailVerified: true },
  });
  // Signup neither requires verification nor withholds the session, so the
  // domain alone proves nothing: anyone can register `someone@nmkr.io`
  // without holding that mailbox. Verification is what the whitelist rests on.
  if (!user?.emailVerified || !isNmkrEmail(user.email)) {
    throw notFound("Soko Bot is not enabled");
  }
  await next();
}

export function mapBot(
  bot: Awaited<ReturnType<typeof sokoBotControlPlane.getForUser>>,
) {
  if (!bot) return null;
  return {
    ...bot,
    memory: bot.memoryRevisions[0] ?? null,
    memoryRevisions: undefined,
  };
}

type TurnWithAttribution = Awaited<
  ReturnType<typeof sokoBotControlPlane.listTurns>
>["turns"][number];

/** Flatten the mention → message → room chain into `chatRoom`. */
export function mapTurn<T extends Partial<TurnWithAttribution>>(turn: T) {
  const room = turn.chatMention?.message?.room ?? null;
  return { ...turn, chatMention: undefined, chatRoom: room };
}

export function mapControlPlaneError(error: unknown): never {
  if (error instanceof SokoBotBillingAccessError)
    throw forbidden(error.message);
  if (error instanceof SokoBotNotFoundError) throw notFound(error.message);
  if (error instanceof SokoBotBusyError) throw conflict(error.message);
  if (
    error instanceof SokoBotStartAbortedError ||
    error instanceof SokoBotIdempotencyConflictError ||
    error instanceof SokoBotRetryableStartError
  ) {
    throw conflict(error.message);
  }
  if (error instanceof SokoBotValidationError) {
    throw unprocessableEntity(error.message);
  }
  if (error instanceof SokoBotRuntimeConflictError)
    throw conflict(error.message);
  if (error instanceof SokoBotRuntimeAuthorizationError)
    throw forbidden(error.message);
  if (error instanceof SokoBotRuntimeValidationError) {
    throw unprocessableEntity(error.message);
  }
  throw error;
}

export function mapIntegrationError(error: unknown): never {
  if (error instanceof ComposioError) {
    throw unprocessableEntity(`Composio: ${error.message}`);
  }
  if (error instanceof SokoBotIntegrationError) {
    if (error.kind === "NOT_CONFIGURED" || error.kind === "NOT_FOUND")
      throw notFound(error.message);
    if (error.kind === "UNKNOWN_PROVIDER") throw notFound(error.message);
    throw unprocessableEntity(error.message);
  }
  throw error;
}
