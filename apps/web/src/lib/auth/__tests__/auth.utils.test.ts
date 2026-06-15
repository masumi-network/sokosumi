import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildAuthCallbackUrl,
  buildOAuthConsentReturnUrl,
  buildOAuthConsentReturnUrlFromSearchParams,
  buildSignUpUrlFromSignIn,
  createAuthSessionGetter,
  getAuthOAuthRedirect,
  getAbsoluteAuthRedirectUrl,
  normalizeAuthReturnUrl,
  waitForAuthSession,
} from "@/lib/auth/auth.utils";

describe("getAuthOAuthRedirect", () => {
  it("returns redirect metadata from top-level payload", () => {
    expect(
      getAuthOAuthRedirect({
        redirect: true,
        url: "/api/auth/oauth2/authorize?client_id=test",
      }),
    ).toEqual({
      redirect: true,
      redirectUrl: "/api/auth/oauth2/authorize?client_id=test",
    });
  });

  it("returns redirect metadata from nested payload", () => {
    expect(
      getAuthOAuthRedirect({
        data: {
          redirect: true,
          url: "/api/auth/oauth2/authorize?client_id=nested",
        },
      }),
    ).toEqual({
      redirect: true,
      redirectUrl: "/api/auth/oauth2/authorize?client_id=nested",
    });
  });

  it("returns non-redirect when redirect metadata is incomplete", () => {
    expect(getAuthOAuthRedirect({ redirect: true })).toEqual({
      redirect: false,
    });
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
});

describe("buildOAuthConsentReturnUrl", () => {
  it("builds a consent return URL when required params are present", () => {
    expect(
      buildOAuthConsentReturnUrl({
        client_id: "client_1",
        redirect_uri: "https://example.com/callback",
        code_challenge: "challenge_1",
        code_challenge_method: "S256",
        scope: "openid",
        state: "state_1",
        response_type: "code",
        exp: "1772367377",
        sig: "signed-value",
      }),
    ).toBe(
      "/oauth/consent?client_id=client_1&redirect_uri=https%3A%2F%2Fexample.com%2Fcallback&code_challenge=challenge_1&code_challenge_method=S256&scope=openid&state=state_1&response_type=code&exp=1772367377&sig=signed-value",
    );
  });

  it("returns undefined when required params are missing", () => {
    expect(
      buildOAuthConsentReturnUrl({
        client_id: "client_1",
        redirect_uri: "https://example.com/callback",
      }),
    ).toBeUndefined();
  });
});

describe("buildOAuthConsentReturnUrlFromSearchParams", () => {
  it("builds a consent return URL from URLSearchParams", () => {
    const params = new URLSearchParams({
      client_id: "client_1",
      redirect_uri: "https://example.com/callback",
      code_challenge: "challenge_1",
      scope: "openid",
      state: "state_1",
      response_type: "code",
    });

    expect(buildOAuthConsentReturnUrlFromSearchParams(params)).toBe(
      "/oauth/consent?client_id=client_1&redirect_uri=https%3A%2F%2Fexample.com%2Fcallback&code_challenge=challenge_1&scope=openid&state=state_1&response_type=code",
    );
  });

  it("preserves signed oauth query and filters app-only params", () => {
    const params = new URLSearchParams({
      client_id: "client_1",
      redirect_uri: "https://example.com/callback",
      code_challenge: "challenge_1",
      code_challenge_method: "S256",
      scope: "openid",
      state: "state_1",
      response_type: "code",
      exp: "1772367377",
      sig: "signed-value",
      returnUrl: "/oauth/consent?foo=bar",
      email: "user@example.com",
    });

    expect(buildOAuthConsentReturnUrlFromSearchParams(params)).toBe(
      "/oauth/consent?client_id=client_1&redirect_uri=https%3A%2F%2Fexample.com%2Fcallback&code_challenge=challenge_1&code_challenge_method=S256&scope=openid&state=state_1&response_type=code&exp=1772367377&sig=signed-value",
    );
  });
});

describe("waitForAuthSession", () => {
  it("returns early when session is available after initial wait", async () => {
    const waitForMs = vi.fn(async () => undefined);
    const getSession = vi.fn().mockResolvedValue({ userId: "user_1" });
    const logWarning = vi.fn();

    await waitForAuthSession({
      context: "login",
      waitForMs,
      getSession,
      logWarning,
      initialDelayMs: 10,
      retryDelayMs: 20,
    });

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

    await waitForAuthSession({
      context: "signup",
      waitForMs,
      getSession,
      logWarning,
      initialDelayMs: 10,
      retryDelayMs: 20,
    });

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

    await waitForAuthSession({
      context: "login",
      waitForMs,
      getSession,
      logWarning,
      initialDelayMs: 10,
      retryDelayMs: 20,
    });

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
