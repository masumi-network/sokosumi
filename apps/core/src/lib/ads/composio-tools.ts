import type { z } from "@hono/zod-openapi";

import {
  ComposioApiError,
  deleteComposioToolSession,
} from "@/clients/composio.client";
import {
  createComposioToolSession,
  executeComposioTool,
} from "@/clients/social-post-providers/tools";
import {
  PROJECT_AD_PROVIDERS,
  type ProjectAdProvider,
} from "@/config/ads-providers";

/** An ad account the connected user can reach, before a Project attaches it. */
export interface AvailableAdAccount {
  externalAccountId: string;
  name: string;
  /** ISO 4217 code. */
  currency: string;
  timeZone: string | null;
}

export interface AdsConnectedAccount {
  connectedAccountId: string;
  executorUserId: string;
}

export type ExecuteAdsTool = (
  toolSlug: string,
  args: Record<string, unknown>,
) => Promise<Record<string, unknown> | null>;

/**
 * Runs `run` in a tool-router session pinned to one connected account and to
 * the given tools only, then deletes the session. The session reuses the
 * Composio tool-session helpers.
 */
export async function withAdsToolSession<T>(
  input: AdsConnectedAccount & {
    provider: ProjectAdProvider;
    toolSlugs: readonly string[];
  },
  run: (execute: ExecuteAdsTool) => Promise<T>,
): Promise<T> {
  const { name, toolkitSlug } = PROJECT_AD_PROVIDERS[input.provider];
  const sessionId = await createComposioToolSession({
    toolkitSlug,
    connectedAccountId: input.connectedAccountId,
    executorUserId: input.executorUserId,
    toolSlugs: input.toolSlugs,
    context: `create Project ${name} session`,
  });
  try {
    return await run((toolSlug, args) =>
      executeComposioTool({
        sessionId,
        toolSlug,
        arguments: args,
        context: `run ${toolSlug}`,
        refused: `${name} refused the request`,
      }),
    );
  } finally {
    await deleteComposioToolSession(
      sessionId,
      `delete Project ${name} session`,
    );
  }
}

function findRows(
  payload: Record<string, unknown> | null,
  key: string,
): unknown[] | null {
  const rows = payload?.[key];
  return Array.isArray(rows) ? rows : null;
}

/** Rows a tool returned under `key`; none when the key is missing. */
export function toolRows(
  payload: Record<string, unknown> | null,
  key: string,
): unknown[] {
  return findRows(payload, key) ?? [];
}

/** Like {@link toolRows}, but a payload without the `key` list is an unusable response. */
export function requireToolRows(
  payload: Record<string, unknown> | null,
  key: string,
  context: string,
): unknown[] {
  const rows = findRows(payload, key);
  if (!rows) {
    throw new ComposioApiError(
      502,
      undefined,
      `${context} returned an invalid response`,
    );
  }
  return rows;
}

/** Parses one payload or row, treating one that does not match as an unusable response. */
export function parseToolRow<T extends z.ZodType>(
  row: unknown,
  schema: T,
  context: string,
): z.infer<T> {
  const parsed = schema.safeParse(row);
  if (!parsed.success) {
    throw new ComposioApiError(
      502,
      undefined,
      `${context} returned an invalid response`,
    );
  }
  return parsed.data;
}

/** Parses every row, treating one that does not match as an unusable response. */
export function parseToolRows<T extends z.ZodType>(
  rows: unknown[],
  schema: T,
  context: string,
): z.infer<T>[] {
  return rows.map((row) => parseToolRow(row, schema, context));
}
