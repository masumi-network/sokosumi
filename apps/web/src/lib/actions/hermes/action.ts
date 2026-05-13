"use server";

import * as Sentry from "@sentry/nextjs";
import {
  hermesInstanceRepository,
  hermesMessageRepository,
} from "@sokosumi/database/repositories";

import { type ActionError, CommonErrorCode } from "@/lib/actions";
import prisma from "@/lib/db/prisma";
import {
  destroyInstance,
  getInstance,
  HermesOrchestratorError,
  HermesOrchestratorNotConfiguredError,
  isReservedSecretKey,
  isValidSecretKey,
  provisionInstance,
  setInstanceSecret,
} from "@/lib/hermes/orchestrator-client";
import type {
  HermesInstancePublic,
  HermesPersistedMessage,
} from "@/lib/hermes/types";
import { Err, Ok, type Result } from "@/lib/ts-res";
import {
  type AuthenticatedRequest,
  withSession,
} from "@/middleware/auth-middleware";

function toActionError(error: unknown, fallback: string): ActionError {
  if (error instanceof HermesOrchestratorNotConfiguredError) {
    return {
      code: "HERMES_ORCH_NOT_CONFIGURED",
      message: error.message,
    };
  }
  if (error instanceof HermesOrchestratorError) {
    return {
      code: error.code,
      message: error.message,
    };
  }
  Sentry.captureException(error, { tags: { context: "hermes_action" } });
  return {
    code: CommonErrorCode.INTERNAL_SERVER_ERROR,
    message: fallback,
  };
}

/**
 * Returns the current Hermes instance state for the signed-in user, or `null`
 * if no instance has been provisioned yet. Lazily upserts the Sokosumi-side
 * `HermesInstance` row on the first observation of an existing orchestrator
 * instance — this backfills users provisioned before the polling table existed.
 */
export const getHermesInstanceAction = withSession<
  Record<string, never>,
  Result<HermesInstancePublic | null, ActionError>
>(async ({ session }) => {
  try {
    const inst = await getInstance(session.user.id);
    if (inst) {
      await hermesInstanceRepository
        .upsertForUser(session.user.id, prisma)
        .catch((err) => {
          Sentry.captureException(err, {
            tags: { context: "hermes_instance_backfill" },
          });
        });
    }
    return Ok(inst);
  } catch (error) {
    return Err(toActionError(error, "Failed to fetch Hermes instance"));
  }
});

/**
 * Provisions a new Hermes instance for the signed-in user (idempotent).
 * Returns the post-provision state — the caller should poll
 * `getHermesInstanceAction` until status === "running".
 */
export const provisionHermesAction = withSession<
  Record<string, never>,
  Result<HermesInstancePublic, ActionError>
>(async ({ session }) => {
  try {
    // Pass name + email so the orchestrator can run its research-intro
    // onboarding pass (the per-user welcome message arrives regardless).
    await provisionInstance(session.user.id, {
      name: session.user.name,
      email: session.user.email,
    });
    const inst = await getInstance(session.user.id);
    if (!inst) {
      return Err({
        code: "HERMES_PROVISION_RACE",
        message: "Provision call succeeded but instance not yet visible.",
      });
    }
    // Track the instance for the inbox cron. Best-effort — failure here
    // doesn't block the user (cron will lazily backfill on next sighting).
    await hermesInstanceRepository
      .upsertForUser(session.user.id, prisma)
      .catch((err) => {
        Sentry.captureException(err, {
          tags: { context: "hermes_instance_upsert" },
        });
      });
    return Ok(inst);
  } catch (error) {
    return Err(toActionError(error, "Failed to provision Hermes instance"));
  }
});

/**
 * Destroys the user's Hermes instance on the orchestrator.
 * Also wipes the user's persisted Hermes conversation history — the new
 * instance will have no skills/memory and the chat surface should mirror
 * that fresh start.
 */
export const destroyHermesAction = withSession<
  Record<string, never>,
  Result<void, ActionError>
>(async ({ session }) => {
  try {
    await destroyInstance(session.user.id);
    await hermesMessageRepository.clearForUser(session.user.id, prisma);
    await hermesInstanceRepository.deleteForUser(session.user.id, prisma);
    return Ok();
  } catch (error) {
    return Err(toActionError(error, "Failed to destroy Hermes instance"));
  }
});

/**
 * Returns the user's persisted Hermes conversation history, oldest first.
 */
export const listHermesMessagesAction = withSession<
  Record<string, never>,
  Result<HermesPersistedMessage[], ActionError>
>(async ({ session }) => {
  try {
    const rows = await hermesMessageRepository.listForUser(
      session.user.id,
      prisma,
    );
    return Ok(
      rows.map((m) => ({
        id: m.id,
        role: (m.role === "user" ||
        m.role === "assistant" ||
        m.role === "system"
          ? m.role
          : "assistant") as "user" | "assistant" | "system",
        content: m.content,
        kind: m.kind,
        createdAt: m.createdAt.toISOString(),
      })),
    );
  } catch (error) {
    return Err(toActionError(error, "Failed to load Hermes messages"));
  }
});

/**
 * Returns the number of agent-initiated push messages (scheduled task results,
 * reminders, …) the user hasn't seen yet. Drives the sidebar unread badge.
 */
export const getHermesUnreadCountAction = withSession<
  Record<string, never>,
  Result<number, ActionError>
>(async ({ session }) => {
  try {
    const count = await hermesInstanceRepository.countUnreadInbox(
      session.user.id,
      prisma,
    );
    return Ok(count);
  } catch (error) {
    return Err(toActionError(error, "Failed to get Hermes unread count"));
  }
});

interface MarkHermesInboxSeenArgs extends AuthenticatedRequest {
  asOfIso?: string;
}

/**
 * Marks the user's Hermes inbox as seen up to `asOfIso` (or now). Called
 * while the user is actively viewing the chat so the sidebar badge clears.
 */
export const markHermesInboxSeenAction = withSession<
  MarkHermesInboxSeenArgs,
  Result<void, ActionError>
>(async ({ asOfIso, session }) => {
  try {
    const asOf = asOfIso ? new Date(asOfIso) : null;
    await hermesInstanceRepository.markInboxSeen(
      { userId: session.user.id, asOf },
      prisma,
    );
    return Ok();
  } catch (error) {
    return Err(toActionError(error, "Failed to mark Hermes inbox as seen"));
  }
});

interface SetHermesSecretArgs extends AuthenticatedRequest {
  key: string;
  value: string;
}

/**
 * Writes a per-user secret into the Hermes instance .env. The Hermes service
 * inside the sprite restarts.
 */
export const setHermesSecretAction = withSession<
  SetHermesSecretArgs,
  Result<void, ActionError>
>(async ({ key, value, session }) => {
  if (!isValidSecretKey(key)) {
    return Err({
      code: CommonErrorCode.BAD_INPUT,
      message:
        "Secret key must match [A-Z_][A-Z0-9_]* (uppercase, digits, underscores).",
    });
  }
  if (isReservedSecretKey(key)) {
    return Err({
      code: "HERMES_SECRET_RESERVED",
      message: `Secret key "${key}" is managed by the orchestrator.`,
    });
  }
  if (value.length === 0) {
    return Err({
      code: CommonErrorCode.BAD_INPUT,
      message: "Secret value must not be empty.",
    });
  }
  try {
    await setInstanceSecret(session.user.id, key, value);
    return Ok();
  } catch (error) {
    return Err(toActionError(error, "Failed to write Hermes secret"));
  }
});
