import { afterEach, describe, expect, it, vi } from "vitest";

const { discardRetiredAblyRealtimeClient } = vi.hoisted(() => ({
  discardRetiredAblyRealtimeClient: vi.fn(),
}));

vi.mock("@/lib/ably/realtime-singleton.client", () => ({
  discardRetiredAblyRealtimeClient,
}));

import {
  buildAuthCallbackUrl,
  buildOAuthResumeUrlFromSearchParams,
  buildSignedOAuthQueryFromSearchParams,
  buildSignInUrlFromSignUp,
  buildSignUpUrlFromSignIn,
  createAuthSessionGetter,
  getAbsoluteAuthRedirectUrl,
  getAbsoluteRedirectUrlForOrigin,
  normalizeAuthReturnUrl,
  waitForAuthSession,
} from "@/lib/auth/auth.utils";

describe("buildSignedOAuthQueryFromSearchParams", () => {
  it("repairs base64 plus characters and keeps only signed parameters", () => {
    const params = new URLSearchParams(
      "client_id=client_1&exp=1772367377&ba_param=ba_param&ba_param=client_id&ba_param=exp&debug=unsigned&sig=abc+def%2Fghi%3D",
    );

    expect(buildSignedOAuthQueryFromSearchParams(params)).toBe(
      "client_id=client_1&exp=1772367377&ba_param=ba_param&ba_param=client_id&ba_param=exp&sig=abc%2Bdef%2Fghi%3D",
    );
  });

  it("returns undefined for an unsigned query", () => {
    expect(
      buildSignedOAuthQueryFromSearchParams(
        new URLSearchParams("client_id=client_1"),
      ),
    ).toBeUndefined();
  });
});

describe("buildAuthCallbackUrl", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("anchors the callback to the current web origin so Core redirects back to the web app", () => {
    vi.stubGlobal("window", {
      location: { origin: "https://preprod.sokosumi.com" },
    });

    expect(buildAuthCallbackUrl("/auth/callback/signin", "google")).toBe(
      "https://preprod.sokosumi.com/auth/callback/signin?provider=google",
    );
  });

  it("includes the returnUrl when provided", () => {
    vi.stubGlobal("window", {
      location: { origin: "https://preprod.sokosumi.com" },
    });

    expect(
      buildAuthCallbackUrl("/auth/callback/signup", "microsoft", "/chat"),
    ).toBe(
      "https://preprod.sokosumi.com/auth/callback/signup?provider=microsoft&returnUrl=%2Fchat",
    );
  });

  it("sanitizes external returnUrl to fallback", () => {
    vi.stubGlobal("window", {
      location: { origin: "https://preprod.sokosumi.com" },
    });

    expect(
      buildAuthCallbackUrl(
        "/auth/callback/signin",
        "google",
        "https://evil.example/attack",
      ),
    ).toBe(
      "https://preprod.sokosumi.com/auth/callback/signin?provider=google&returnUrl=%2F",
    );
  });

  it("rejects a protocol-relative returnUrl to fallback", () => {
    vi.stubGlobal("window", {
      location: { origin: "https://preprod.sokosumi.com" },
    });

    expect(
      buildAuthCallbackUrl("/auth/callback/signin", "google", "//evil.com"),
    ).toBe(
      "https://preprod.sokosumi.com/auth/callback/signin?provider=google&returnUrl=%2F",
    );
  });

  it("falls back to a relative path when window is unavailable (SSR)", () => {
    vi.stubGlobal("window", undefined);

    expect(buildAuthCallbackUrl("/auth/callback/signin", "google")).toBe(
      "/auth/callback/signin?provider=google",
    );
  });

  it("sanitizes external returnUrl to fallback during SSR", () => {
    vi.stubGlobal("window", undefined);

    expect(
      buildAuthCallbackUrl(
        "/auth/callback/signin",
        "google",
        "https://evil.example/attack",
      ),
    ).toBe("/auth/callback/signin?provider=google&returnUrl=%2F");
  });
});

describe("getAbsoluteAuthRedirectUrl", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("anchors a safe relative path to the web origin", () => {
    vi.stubGlobal("window", {
      location: { origin: "https://preprod.sokosumi.com" },
    });

    expect(getAbsoluteAuthRedirectUrl("/chat", "/")).toBe(
      "https://preprod.sokosumi.com/chat",
    );
  });

  it("anchors fallback when returnUrl is missing", () => {
    vi.stubGlobal("window", {
      location: { origin: "https://preprod.sokosumi.com" },
    });

    expect(getAbsoluteAuthRedirectUrl(undefined, "/")).toBe(
      "https://preprod.sokosumi.com/",
    );
  });

  it("returns fallback origin URL for external returnUrl", () => {
    vi.stubGlobal("window", {
      location: { origin: "https://preprod.sokosumi.com" },
    });

    expect(
      getAbsoluteAuthRedirectUrl("https://evil.example/attack", "/chat"),
    ).toBe("https://preprod.sokosumi.com/chat");
  });

  it("falls back to a relative path when window is unavailable (SSR)", () => {
    vi.stubGlobal("window", undefined);

    expect(getAbsoluteAuthRedirectUrl("/chat", "/")).toBe("/chat");
  });

  it("sanitizes an external returnUrl to fallback during SSR", () => {
    vi.stubGlobal("window", undefined);

    expect(
      getAbsoluteAuthRedirectUrl("https://evil.example/attack", "/chat"),
    ).toBe("/chat");
  });

  it("rejects a protocol-relative returnUrl during SSR", () => {
    vi.stubGlobal("window", undefined);

    expect(getAbsoluteAuthRedirectUrl("//evil.com", "/chat")).toBe("/chat");
  });
});

describe("getAbsoluteRedirectUrlForOrigin", () => {
  it("anchors a safe relative path to the provided origin", () => {
    expect(
      getAbsoluteRedirectUrlForOrigin(
        "https://preprod.sokosumi.com",
        "/billing?tab=subscription&status=success",
      ),
    ).toBe(
      "https://preprod.sokosumi.com/billing?tab=subscription&status=success",
    );
  });

  it("rejects external returnUrl values", () => {
    expect(
      getAbsoluteRedirectUrlForOrigin(
        "https://preprod.sokosumi.com",
        "https://evil.example/attack",
        "/billing",
      ),
    ).toBe("https://preprod.sokosumi.com/billing");
  });
});

describe("normalizeAuthReturnUrl", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns / when returnUrl is missing", () => {
    expect(normalizeAuthReturnUrl(undefined)).toBe("/");
  });

  it("returns / when returnUrl is root", () => {
    expect(normalizeAuthReturnUrl("/")).toBe("/");
  });

  it("returns safe non-root relative returnUrl", () => {
    expect(normalizeAuthReturnUrl("/accept-invitation/invite_123")).toBe(
      "/accept-invitation/invite_123",
    );
  });

  it("returns / for external returnUrl", () => {
    vi.stubGlobal("window", {
      location: { origin: "https://preprod.sokosumi.com" },
    });

    expect(normalizeAuthReturnUrl("https://evil.example/attack")).toBe("/");
  });

  it("returns / for unsupported protocols", () => {
    vi.stubGlobal("window", {
      location: { origin: "https://preprod.sokosumi.com" },
    });

    expect(normalizeAuthReturnUrl("javascript:alert('x')")).toBe("/");
  });

  it("returns / for external returnUrl during SSR", () => {
    vi.stubGlobal("window", undefined);

    expect(normalizeAuthReturnUrl("https://evil.example/attack")).toBe("/");
  });
});

describe("buildSignUpUrlFromSignIn", () => {
  it("returns bare signup path when no params are provided", () => {
    expect(buildSignUpUrlFromSignIn({})).toBe("/signup");
  });

  it("preserves returnUrl and email in signup link", () => {
    expect(
      buildSignUpUrlFromSignIn({
        returnUrl: "/accept-invitation/invite_123?foo=bar",
        email: "user@example.com",
      }),
    ).toBe(
      "/signup?returnUrl=%2Faccept-invitation%2Finvite_123%3Ffoo%3Dbar&email=user%40example.com",
    );
  });

  it("carries the OAuth request as the sign-up page's own query", () => {
    expect(
      buildSignUpUrlFromSignIn({
        oauthQuery: "client_id=client_1&exp=1772367377&sig=signed",
        email: "user@example.com",
      }),
    ).toBe(
      "/signup?client_id=client_1&exp=1772367377&sig=signed&email=user%40example.com",
    );
  });
});

describe("buildSignInUrlFromSignUp", () => {
  it("returns bare signin path without an OAuth request or returnUrl", () => {
    expect(buildSignInUrlFromSignUp({})).toBe("/signin");
  });

  it("carries the OAuth request as the sign-in page's own query", () => {
    expect(
      buildSignInUrlFromSignUp({
        oauthQuery:
          "client_id=client_1&exp=1772367377&sig=mVXxByc5E32WEKh8YvwTBB%2BvbGZAR42ECbHJf8K%2F24s%3D",
      }),
    ).toBe(
      "/signin?client_id=client_1&exp=1772367377&sig=mVXxByc5E32WEKh8YvwTBB%2BvbGZAR42ECbHJf8K%2F24s%3D",
    );
  });
});

describe("buildOAuthResumeUrlFromSearchParams", () => {
  it("returns undefined without a signed OAuth request", () => {
    const params = new URLSearchParams({
      client_id: "client_1",
      redirect_uri: "https://example.com/callback",
      code_challenge: "challenge_1",
    });

    expect(buildOAuthResumeUrlFromSearchParams(params)).toBeUndefined();
  });

  it("points at the sign-in page with the signed request and no app-only params", () => {
    const params = new URLSearchParams({
      client_id: "client_1",
      redirect_uri: "https://example.com/callback",
      code_challenge: "challenge_1",
      exp: "1772367377",
      sig: "signed-value",
      returnUrl: "/chat",
      email: "user@example.com",
    });

    expect(buildOAuthResumeUrlFromSearchParams(params)).toBe(
      "/signin?client_id=client_1&redirect_uri=https%3A%2F%2Fexample.com%2Fcallback&code_challenge=challenge_1&exp=1772367377&sig=signed-value",
    );
  });

  it("repairs a base64 signature whose encoded plus was decoded as a space", () => {
    const params = new URLSearchParams(
      "client_id=client_1&exp=1772367377&sig=mVXxByc5E32WEKh8YvwTBB+vbGZAR42ECbHJf8K%2F24s%3D",
    );

    expect(buildOAuthResumeUrlFromSearchParams(params)).toBe(
      "/signin?client_id=client_1&exp=1772367377&sig=mVXxByc5E32WEKh8YvwTBB%2BvbGZAR42ECbHJf8K%2F24s%3D",
    );
  });
});

describe("waitForAuthSession", () => {
  /**
   * Every sign-in path waits here and then navigates with `router.replace`, so
   * the document survives and a client the Ably singleton retired for a lost
   * session would survive with it. This is the one seam all four paths share.
   */
  it("discards a retired Ably client, because a sign-in just happened", async () => {
    const waitForMs = vi.fn(async () => undefined);
    // Every test in this block calls the seam, and nothing clears the
    // module-scoped mock, so the count would otherwise depend on test order.
    discardRetiredAblyRealtimeClient.mockClear();

    await waitForAuthSession({
      context: "login",
      waitForMs,
      getSession: vi.fn().mockResolvedValue({ userId: "user_1" }),
      logWarning: vi.fn(),
    });
    // The import is dynamic and deliberately not awaited, so let it settle.
    await vi.waitFor(() => {
      expect(discardRetiredAblyRealtimeClient).toHaveBeenCalledOnce();
    });
  });

  it("returns early when session is available after initial wait", async () => {
    const waitForMs = vi.fn(async () => undefined);
    const getSession = vi.fn().mockResolvedValue({ userId: "user_1" });
    const logWarning = vi.fn();

    const session = await waitForAuthSession({
      context: "login",
      waitForMs,
      getSession,
      logWarning,
      initialDelayMs: 10,
      retryDelayMs: 20,
    });

    expect(session).toEqual({ userId: "user_1" });
    expect(waitForMs).toHaveBeenCalledTimes(1);
    expect(waitForMs).toHaveBeenCalledWith(10);
    expect(getSession).toHaveBeenCalledTimes(1);
    expect(logWarning).not.toHaveBeenCalled();
  });

  it("retries once and logs waiting warning when first session check fails", async () => {
    const waitForMs = vi.fn(async () => undefined);
    const getSession = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ userId: "user_1" });
    const logWarning = vi.fn();

    const session = await waitForAuthSession({
      context: "signup",
      waitForMs,
      getSession,
      logWarning,
      initialDelayMs: 10,
      retryDelayMs: 20,
    });

    expect(session).toEqual({ userId: "user_1" });
    expect(waitForMs).toHaveBeenCalledTimes(2);
    expect(waitForMs).toHaveBeenNthCalledWith(1, 10);
    expect(waitForMs).toHaveBeenNthCalledWith(2, 20);
    expect(getSession).toHaveBeenCalledTimes(2);
    expect(logWarning).toHaveBeenCalledTimes(1);
    expect(logWarning).toHaveBeenCalledWith(
      "Session not established after signup, waiting for 20ms",
    );
  });

  it("logs second warning when session is still unavailable after retry", async () => {
    const waitForMs = vi.fn(async () => undefined);
    const getSession = vi.fn().mockResolvedValue(null);
    const logWarning = vi.fn();

    const session = await waitForAuthSession({
      context: "login",
      waitForMs,
      getSession,
      logWarning,
      initialDelayMs: 10,
      retryDelayMs: 20,
    });

    expect(session).toBeNull();
    expect(logWarning).toHaveBeenCalledTimes(2);
    expect(logWarning).toHaveBeenNthCalledWith(
      1,
      "Session not established after login, waiting for 20ms",
    );
    expect(logWarning).toHaveBeenNthCalledWith(
      2,
      "Session not established after login, proceeding with redirect anyway",
    );
  });

  it("treats a hung getSession as missing and continues", async () => {
    const waitForMs = vi.fn(async () => undefined);
    const getSession = vi.fn(() => new Promise(() => {}));
    const logWarning = vi.fn();

    const session = await waitForAuthSession({
      context: "login",
      waitForMs,
      getSession,
      logWarning,
      initialDelayMs: 0,
      retryDelayMs: 0,
      sessionTimeoutMs: 20,
    });

    expect(session).toBeNull();
    expect(getSession).toHaveBeenCalledTimes(2);
    expect(logWarning).toHaveBeenCalledTimes(2);
  });
});

describe("createAuthSessionGetter", () => {
  it("unwraps session data from the Better Auth response shape", async () => {
    const getSession = createAuthSessionGetter(async () => ({
      data: {
        session: {
          id: "session_1",
        },
      },
    }));

    await expect(getSession()).resolves.toEqual({ id: "session_1" });
  });

  it("returns null when the Better Auth response has no session", async () => {
    const getSession = createAuthSessionGetter(async () => ({
      data: null,
    }));

    await expect(getSession()).resolves.toBeNull();
  });
});
