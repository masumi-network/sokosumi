const AUTH_SESSION_INITIAL_WAIT_MS = 200;
const AUTH_SESSION_RETRY_WAIT_MS = 500;

interface WaitForAuthSessionOptions {
  context: "login" | "signup";
  getSession: () => Promise<unknown>;
  logWarning: (message: string) => void;
  initialDelayMs?: number;
  retryDelayMs?: number;
  waitForMs?: (ms: number) => Promise<void>;
}

function waitForMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function waitForAuthSession({
  context,
  getSession,
  logWarning,
  initialDelayMs = AUTH_SESSION_INITIAL_WAIT_MS,
  retryDelayMs = AUTH_SESSION_RETRY_WAIT_MS,
  waitForMs: waitForMsFn = waitForMs,
}: WaitForAuthSessionOptions): Promise<void> {
  await waitForMsFn(initialDelayMs);

  const session = await getSession();
  if (session) {
    return;
  }

  logWarning(
    `Session not established after ${context}, waiting for ${retryDelayMs}ms`,
  );
  await waitForMsFn(retryDelayMs);

  const retrySession = await getSession();
  if (!retrySession) {
    logWarning(
      `Session not established after ${context}, proceeding with redirect anyway`,
    );
  }
}

export function getValidAuthRedirectUrl(
  returnUrl: string | undefined,
  fallback: string = "/",
): string {
  if (!returnUrl) {
    return fallback;
  }

  try {
    const parsedUrl = new URL(returnUrl, window.location.origin);
    return parsedUrl.origin === window.location.origin ? returnUrl : fallback;
  } catch {
    return fallback;
  }
}
