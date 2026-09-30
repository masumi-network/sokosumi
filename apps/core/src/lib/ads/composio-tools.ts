import type { z } from "@hono/zod-openapi";

import {
  ComposioApiError,
  deleteComposioToolSession,
  record,
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

/**
 * Rows of a tool payload: under `key`, or under `data` either directly or as a
 * list of streamed batches that each hold their rows under `key`.
 */
export function toolRows(
  payload: Record<string, unknown> | null,
  key: string,
): unknown[] {
  const direct = payload?.[key];
  if (Array.isArray(direct)) return direct;
  const data = payload?.data;
  if (!Array.isArray(data)) return [];
  return data.flatMap((batch) => {
    const rows = record(batch)?.[key];
    return Array.isArray(rows) ? rows : [batch];
  });
}

/** Parses every row, treating one that does not match as an unusable response. */
export function parseToolRows<T extends z.ZodType>(
  rows: unknown[],
  schema: T,
  context: string,
): z.infer<T>[] {
  return rows.map((row) => {
    const parsed = schema.safeParse(row);
    if (!parsed.success) {
      throw new ComposioApiError(
        502,
        undefined,
        `${context} returned an invalid response`,
      );
    }
    return parsed.data;
  });
}
