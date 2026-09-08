import type { TokenRequest } from "ably";

const ABLY_BROWSER_AUTH_PATH = "/api/ably/auth";
// Allow the Core token request its five-second deadline plus proxy overhead.
const ABLY_BROWSER_AUTH_TIMEOUT_MS = 10_000;

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
 * 401 is session-loss; other HTTP failures stay distinguishable by status.
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
