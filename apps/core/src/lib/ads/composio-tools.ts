import type { z } from "@hono/zod-openapi";

import {
  ComposioApiError,
  deleteProjectSocialSession,
} from "@/clients/composio.client";
import {
  createSocialPublishSession,
  executeSocialPublishTool,
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
  /** Google manager account id to send as `login-customer-id`; null for direct access and Meta. */
  loginCustomerId: string | null;
}

export interface AdsConnectedAccount {
  connectedAccountId: string;
  executorUserId: string;
}

export type ExecuteAdsTool = (
  toolSlug: string,
  args: Record<string, unknown>,
) => Promise<unknown>;

/**
 * Runs `run` in a tool-router session pinned to one connected account and to
 * the given tools only, then deletes the session. The session reuses the
 * social publish helpers, which are not specific to social toolkits.
 */
export async function withAdsToolSession<T>(
  input: AdsConnectedAccount & {
    provider: ProjectAdProvider;
    toolSlugs: readonly string[];
  },
  run: (execute: ExecuteAdsTool) => Promise<T>,
): Promise<T> {
  const { name, toolkitSlug } = PROJECT_AD_PROVIDERS[input.provider];
  const sessionId = await createSocialPublishSession({
    toolkitSlug,
    connectedAccountId: input.connectedAccountId,
    executorUserId: input.executorUserId,
    toolSlugs: input.toolSlugs,
    context: `create Project ${name} session`,
  });
  try {
    return await run((toolSlug, args) =>
      executeSocialPublishTool({
        sessionId,
        toolSlug,
        arguments: args,
        context: `run ${toolSlug}`,
        refused: `${name} refused the request`,
      }),
    );
  } finally {
    await deleteProjectSocialSession(
      sessionId,
      `delete Project ${name} session`,
    );
  }
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function findRows(
  value: unknown,
  key: string,
  depth: number,
): unknown[] | null {
  if (depth > 5) return null;
  const parsed = typeof value === "string" ? parseJson(value) : value;
  if (Array.isArray(parsed)) {
    // A streamed result is a list of batches; a plain list holds the rows.
    return parsed.flatMap((item) => findRows(item, key, depth + 1) ?? [item]);
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const fields = parsed as Record<string, unknown>;
  if (Array.isArray(fields[key])) return fields[key];
  return "data" in fields ? findRows(fields.data, key, depth + 1) : null;
}

/**
 * Rows of a tool result, however Composio wrapped them: under `key`, under
 * `data`, as a JSON string, or as a list of streamed batches.
 */
export function toolRows(payload: unknown, key: string): unknown[] {
  return findRows(payload, key, 0) ?? [];
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
