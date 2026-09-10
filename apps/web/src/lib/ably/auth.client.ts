import type { TokenRequest } from "ably";

const ABLY_BROWSER_AUTH_PATH = "/api/ably/auth";
// 9s, strictly inside ably-js's 10s realtimeRequestTimeout and outside the
// 7s Core mint. Two clocks at 10s let ably-js replace a classified error.
const ABLY_BROWSER_AUTH_TIMEOUT_MS = 9_000;

export class AblyBrowserAuthError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "AblyBrowserAuthError";
    this.status = status;
  }
}

/**
 * Browser fetch of POST /api/ably/auth (cookies included).
 * 401 is Core unauthorized on this mint, not a confirmed logout. The
 * singleton passes it to ably-js to retry. Other HTTP failures stay
 * distinguishable by status.
 */
export async function fetchAblyBrowserAuthTokenRequest(
  clientInstanceId: string,
): Promise<TokenRequest> {
  const params = new URLSearchParams({ clientInstanceId });
  const response = await fetch(`${ABLY_BROWSER_AUTH_PATH}?${params}`, {
    method: "POST",
    credentials: "include",
    headers: {
      Accept: "application/json",
    },
    cache: "no-store",
    signal: AbortSignal.timeout(ABLY_BROWSER_AUTH_TIMEOUT_MS),
  });

  if (response.status === 401) {
    throw new AblyBrowserAuthError(401, "Ably auth failed: session is gone");
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new AblyBrowserAuthError(
      response.status,
      `Ably auth failed (${response.status})${detail ? `: ${detail}` : ""}`,
    );
  }

  const body: unknown = await response.json();
  if (body == null || typeof body !== "object") {
    throw new Error("Ably auth returned an empty payload");
  }

  return body as TokenRequest;
}
