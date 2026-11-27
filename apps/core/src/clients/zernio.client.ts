import { getEnv } from "@/config/env";
import { integrationNotConfigured } from "@/helpers/error";
import {
  refuseEvalSocialAccount,
  refuseEvalSocialAccountInPath,
} from "@/lib/evals/eval-social-account";

const API_BASE = "https://zernio.com/api/v1";

export function getZernioAccountId(connectedAccountId: string): string | null {
  return connectedAccountId.startsWith("zernio:")
    ? connectedAccountId.slice("zernio:".length) || null
    : null;
}

export class ZernioApiError extends Error {
  constructor(readonly status: number) {
    super(`Zernio returned HTTP ${status}`);
    this.name = "ZernioApiError";
  }
}

/** The accounts a request body names: its own, or each platform's on a post. */
function zernioAccountIds(body: unknown): string[] {
  const { accountId, platforms } = (body ?? {}) as {
    accountId?: unknown;
    platforms?: unknown;
  };
  return [
    accountId,
    ...(Array.isArray(platforms)
      ? platforms.map(
          (platform) => (platform as { accountId?: unknown })?.accountId,
        )
      : []),
  ].filter((id): id is string => typeof id === "string");
}

export async function zernioRequest(
  path: string,
  options: {
    method?: "GET" | "POST" | "DELETE";
    body?: unknown;
    signal?: AbortSignal;
    idempotencyKey?: string;
    /** Extra headers, such as the connect token of a sign-in in progress. */
    headers?: Record<string, string>;
  } = {},
): Promise<unknown> {
  refuseEvalSocialAccountInPath("Zernio", path);
  refuseEvalSocialAccount("Zernio", ...zernioAccountIds(options.body));
  const apiKey = getEnv().ZERNIO_API_KEY;
  if (!apiKey) throw integrationNotConfigured();
  const response = await fetch(`${API_BASE}${path}`, {
    method: options.method ?? "GET",
    redirect: "error",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      ...(options.body !== undefined && { "Content-Type": "application/json" }),
      ...(options.idempotencyKey && {
        "Idempotency-Key": options.idempotencyKey,
      }),
      ...options.headers,
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: options.signal ?? AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new ZernioApiError(response.status);
  if (response.status === 204) return null;
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}
