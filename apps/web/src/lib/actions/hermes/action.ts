"use server";

import * as Sentry from "@sentry/nextjs";

import type { ActionError } from "@/lib/actions";
import {
  CoreApiRequestError,
  coreClient,
  toCoreApiActionError,
} from "@/lib/clients/core.client";
import type { HermesInstance } from "@/lib/clients/generated/core";
import type {
  HermesInstancePublic,
  HermesPersistedMessage,
} from "@/lib/hermes/types";
import { Err, Ok, type Result } from "@/lib/ts-res";
import {
  type AuthenticatedRequest,
  withSession,
} from "@/middleware/auth-middleware";

const HERMES_MESSAGE_PAGE_LIMIT = 100;

function toActionError(error: unknown): ActionError {
  if (!(error instanceof CoreApiRequestError)) {
    Sentry.captureException(error, { tags: { context: "hermes_action" } });
  }

  return toCoreApiActionError(error);
}

function toIsoString(value: Date | string | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : value;
}

function mapHermesInstance(
  instance: HermesInstance | null,
): HermesInstancePublic | null {
  if (!instance) return null;

  return {
    status: instance.status,
    endpointUrl: instance.endpointUrl,
    lastActivityAt: toIsoString(instance.lastActivityAt),
  };
}

function mapHermesMessage(
  message: Awaited<
    ReturnType<typeof coreClient.getHermesMessages>
  >["data"][number],
): HermesPersistedMessage {
  return {
    id: message.id,
    role: message.role,
    content: message.content,
    kind: message.kind,
    createdAt: toIsoString(message.createdAt) ?? new Date(0).toISOString(),
  };
}

async function listAllHermesMessages(): Promise<HermesPersistedMessage[]> {
  const messages: HermesPersistedMessage[] = [];
  let cursor: string | undefined;

  do {
    const response = await coreClient.getHermesMessages({
      cursor,
      limit: HERMES_MESSAGE_PAGE_LIMIT,
    });
    messages.push(...response.data.map(mapHermesMessage));
    cursor = response.meta?.pagination?.nextCursor ?? undefined;
  } while (cursor);

  return messages;
}

/**
 * Returns the current Hermes instance state for the signed-in user, or `null`
 * if no instance has been provisioned yet.
 */
export const getHermesInstanceAction = withSession<
  Record<string, never>,
  Result<HermesInstancePublic | null, ActionError>
>(async () => {
  try {
    const response = await coreClient.getHermesInstance();
    const body = response.data;
    if (!body.hasInstance) return Ok(null);
    return Ok(mapHermesInstance(body.instance));
  } catch (error) {
    return Err(toActionError(error));
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
>(async () => {
  try {
    const response = await coreClient.provisionHermesInstance();
    return Ok(mapHermesInstance(response.data)!);
  } catch (error) {
    return Err(toActionError(error));
  }
});

/**
 * Destroys the user's Hermes instance and clears its persisted history in Core.
 */
export const destroyHermesAction = withSession<
  Record<string, never>,
  Result<void, ActionError>
>(async () => {
  try {
    await coreClient.destroyHermesInstance();
    return Ok();
  } catch (error) {
    return Err(toActionError(error));
  }
});

/**
 * Returns the user's persisted Hermes conversation history, oldest first.
 */
export const listHermesMessagesAction = withSession<
  Record<string, never>,
  Result<HermesPersistedMessage[], ActionError>
>(async () => {
  try {
    return Ok(await listAllHermesMessages());
  } catch (error) {
    return Err(toActionError(error));
  }
});

/**
 * Returns the number of agent-initiated push messages (scheduled task results,
 * reminders, …) the user hasn't seen yet. Drives the sidebar unread badge.
 */
export const getHermesUnreadCountAction = withSession<
  Record<string, never>,
  Result<number, ActionError>
>(async () => {
  try {
    const response = await coreClient.getHermesUnreadCount();
    return Ok(response.data.count);
  } catch (error) {
    return Err(toActionError(error));
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
>(async ({ asOfIso }) => {
  try {
    await coreClient.markHermesInboxSeen(
      asOfIso ? { asOfIso: new Date(asOfIso) } : undefined,
    );
    return Ok();
  } catch (error) {
    return Err(toActionError(error));
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
>(async ({ key, value }) => {
  try {
    await coreClient.setHermesSecret({ key, value });
    return Ok();
  } catch (error) {
    return Err(toActionError(error));
  }
});
