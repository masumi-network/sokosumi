import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { discardRetiredAblyRealtimeClient } = vi.hoisted(() => ({
  discardRetiredAblyRealtimeClient: vi.fn(),
}));

vi.mock("@/lib/ably/realtime-singleton.client", () => ({
  discardRetiredAblyRealtimeClient,
}));

import {
  buildAuthPageUrl,
  buildOAuthResumeUrlFromSearchParams,
  buildSignedOAuthQueryFromSearchParams,
  buildSocialCallbackUrls,
  createAuthSessionGetter,
  getAbsoluteAuthRedirectUrl,
  getAbsoluteRedirectUrlForOrigin,
  normalizeAuthReturnUrl,
  oauthRequestAsksForNewAccount,
  oauthRequestExpiresSoon,
  oauthRequestHasExpired,
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

  it("leaves out the error a failed sign-in brought back", () => {
    const params = new URLSearchParams(
      "client_id=client_1&exp=1772367377&sig=abc&error=access_denied&error_description=denied",
    );

    expect(buildSignedOAuthQueryFromSearchParams(params)).toBe(
      "client_id=client_1&exp=1772367377&sig=abc",
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

describe("oauthRequestAsksForNewAccount", () => {
  it.each([
    ["create", true],
    ["consent create", true],
    ["login", false],
    ["created", false],
  ])("reads prompt=%s as %s", (prompt, expected) => {
    expect(
      oauthRequestAsksForNewAccount(`client_id=cmo&prompt=${prompt}`),
    ).toBe(expected);
  });

  it("finds no request for a new account without a prompt", () => {
    expect(oauthRequestAsksForNewAccount("client_id=cmo")).toBe(false);
  });
});

describe("oauthRequestExpiresSoon", () => {
  // `exp` is in seconds: 2026-09-30T10:10:00Z.
  const QUERY = `client_id=cmo&exp=${Date.parse("2026-09-30T10:10:00Z") / 1000}`;

  afterEach(() => {
    vi.useRealTimers();
  });

  it.each([
    ["with five minutes left", "2026-09-30T10:05:00Z", false],
    ["with exactly two minutes left", "2026-09-30T10:08:00Z", true],
    ["with one minute left", "2026-09-30T10:09:00Z", true],
    ["after it expired", "2026-09-30T10:11:00Z", true],
  ])("reads a request %s as %s", (_when, now, expected) => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(now));

    expect(oauthRequestExpiresSoon(QUERY)).toBe(expected);
  });

  it.each([
    ["no", "client_id=cmo"],
    ["an unreadable", "client_id=cmo&exp=soon"],
  ])("treats a request with %s expiry as expiring", (_kind, query) => {
    expect(oauthRequestExpiresSoon(query)).toBe(true);
  });
});

describe("oauthRequestHasExpired", () => {
  const EXPIRES_AT = Date.parse("2026-09-30T10:10:00Z");
  const QUERY = `client_id=cmo&exp=${EXPIRES_AT / 1000}&sig=signed-value`;

  afterEach(() => {
    vi.useRealTimers();
  });

  it.each([
    ["before expiry", -1, false],
    ["at expiry", 0, false],
    ["inside the margin", 29_999, false],
    ["at the margin", 30_000, false],
    ["beyond the margin", 30_001, true],
  ])("reads a request %s", (_when, elapsed, expected) => {
    vi.useFakeTimers({ toFake: ["Date"], now: EXPIRES_AT + elapsed });
    expect(oauthRequestHasExpired(QUERY)).toBe(expected);
  });

  it.each([
    "",
    "exp=",
    "exp=soon",
    "exp=NaN",
    "exp=Infinity",
    "exp=-Infinity",
    "exp=0",
    "exp=-1",
    "exp=1.5",
    "exp=1e3",
    "exp=0x10",
    "exp=01",
    "exp=+1",
    "exp=9007199254740993",
    "exp=8640000000001",
    "exp=1&exp=9999999999",
    "exp=9999999999&exp=1",
  ])("leaves malformed expiry to Core (%s)", (expiry) => {
    vi.useFakeTimers({ toFake: ["Date"], now: EXPIRES_AT + 60_000 });
    expect(
      oauthRequestHasExpired(`client_id=cmo&${expiry}&sig=signed-value`),
    ).toBe(false);
  });
});

describe("buildSocialCallbackUrls", () => {
  function stubLocation(href: string) {
    vi.stubGlobal("window", {
      location: { href, origin: new URL(href).origin },
    });
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("anchors the callbacks to the current web origin so Core redirects back to the web app", () => {
    stubLocation("https://preprod.sokosumi.com/signin");

    expect(buildSocialCallbackUrls("google", undefined)).toEqual({
      callbackURL:
        "https://preprod.sokosumi.com/auth/callback/signin?provider=google",
      newUserCallbackURL:
        "https://preprod.sokosumi.com/auth/callback/signup?provider=google",
      errorCallbackURL: "https://preprod.sokosumi.com/signin",
    });
  });

  it("includes the returnUrl when provided", () => {
    stubLocation("https://preprod.sokosumi.com/signup");

    expect(buildSocialCallbackUrls("microsoft", "/chat")).toMatchObject({
      callbackURL:
        "https://preprod.sokosumi.com/auth/callback/signin?provider=microsoft&returnUrl=%2Fchat",
      newUserCallbackURL:
        "https://preprod.sokosumi.com/auth/callback/signup?provider=microsoft&returnUrl=%2Fchat",
    });
  });

  it.each(["https://evil.example/attack", "//evil.com"])(
    "sanitizes the returnUrl %s to fallback",
    (returnUrl) => {
      stubLocation("https://preprod.sokosumi.com/signin");

      expect(buildSocialCallbackUrls("google", returnUrl).callbackURL).toBe(
        "https://preprod.sokosumi.com/auth/callback/signin?provider=google&returnUrl=%2F",
      );
    },
  );

  it("falls back to relative callbacks and no error page during SSR", () => {
    vi.stubGlobal("window", undefined);

    expect(
      buildSocialCallbackUrls("google", "https://evil.example/attack"),
    ).toEqual({
      callbackURL: "/auth/callback/signin?provider=google&returnUrl=%2F",
      newUserCallbackURL: "/auth/callback/signup?provider=google&returnUrl=%2F",
      errorCallbackURL: undefined,
    });
  });

  it("returns a failed sign-in to the page it started on", () => {
    stubLocation(
      "https://preprod.sokosumi.com/signin?returnUrl=%2Fchat#methods",
    );

    expect(buildSocialCallbackUrls("google", "/chat").errorCallbackURL).toBe(
      "https://preprod.sokosumi.com/signin?returnUrl=%2Fchat",
    );
  });

  it("drops the error of an earlier attempt", () => {
    stubLocation(
      "https://preprod.sokosumi.com/signup?error=access_denied&error_description=denied&client_id=cmo",
    );

    expect(buildSocialCallbackUrls("google", undefined).errorCallbackURL).toBe(
      "https://preprod.sokosumi.com/signup?client_id=cmo",
    );
  });

  it("returns to another page with the same query when asked", () => {
    stubLocation(
      "https://preprod.sokosumi.com/auth/google?returnUrl=%2Fchat&error=access_denied",
    );

    expect(
      buildSocialCallbackUrls("google", "/chat", "/signup").errorCallbackURL,
    ).toBe("https://preprod.sokosumi.com/signup?returnUrl=%2Fchat");
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

  it("keeps a full URL on the provided origin, not the page's", () => {
    expect(
      getAbsoluteRedirectUrlForOrigin(
        "https://preprod.sokosumi.com",
        "https://preprod.sokosumi.com/jobs#latest",
      ),
    ).toBe("https://preprod.sokosumi.com/jobs#latest");
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

  it.each([
    "/.//evil.example",
    "/foo/..//evil.example",
    "https://preprod.sokosumi.com/.//evil.example",
  ])("rejects a path that parses as another host: %s", (returnUrl) => {
    expect(
      getAbsoluteRedirectUrlForOrigin(
        "https://preprod.sokosumi.com",
        returnUrl,
        "/billing",
      ),
    ).toBe("https://preprod.sokosumi.com/billing");
  });

  it("keeps a collapsed same-origin dot segment", () => {
    expect(
      getAbsoluteRedirectUrlForOrigin(
        "https://preprod.sokosumi.com",
        "/foo/../chat?x=1#y",
      ),
    ).toBe("https://preprod.sokosumi.com/chat?x=1#y");
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

  it.each([
    ["https://localhost.invalid/phish", "/phish"],
    ["//localhost.invalid/phish", "/phish"],
  ])(
    "drops the SSR placeholder origin from a returnUrl: %s",
    (returnUrl, expected) => {
      vi.stubGlobal("window", undefined);

      expect(normalizeAuthReturnUrl(returnUrl)).toBe(expected);
    },
  );

  it("roots a fragment-only returnUrl so it leaves the current page", () => {
    vi.stubGlobal("window", undefined);

    expect(normalizeAuthReturnUrl("#details")).toBe("/#details");
  });

  it("keeps an internal path with its query and fragment", () => {
    vi.stubGlobal("window", undefined);

    expect(normalizeAuthReturnUrl("/chat?filter=unread#details")).toBe(
      "/chat?filter=unread#details",
    );
  });

  it.each([
    "https://evil.example/attack",
    "//evil.example/attack",
    "/\\evil.example/attack",
    "/.//evil.example",
    "/foo/..//evil.example",
    "javascript:alert('x')",
  ])("returns / for an off-site returnUrl during SSR: %s", (returnUrl) => {
    vi.stubGlobal("window", undefined);

    expect(normalizeAuthReturnUrl(returnUrl)).toBe("/");
  });
});

describe("buildAuthPageUrl for sign-up", () => {
  it("returns bare signup path when no params are provided", () => {
    expect(buildAuthPageUrl("/signup", {})).toBe("/signup");
  });

  it("preserves returnUrl in signup link", () => {
    expect(
      buildAuthPageUrl("/signup", {
        returnUrl: "/accept-invitation/invite_123?foo=bar",
      }),
    ).toBe("/signup?returnUrl=%2Faccept-invitation%2Finvite_123%3Ffoo%3Dbar");
  });

  it("carries the OAuth request as the sign-up page's own query", () => {
    expect(
      buildAuthPageUrl("/signup", {
        oauthQuery: "client_id=client_1&exp=1772367377&sig=signed",
        returnUrl: "/agents",
      }),
    ).toBe(
      "/signup?client_id=client_1&exp=1772367377&sig=signed&returnUrl=%2Fagents",
    );
  });
});

describe("buildAuthPageUrl for sign-up with an invitation", () => {
  // Sign-up looks the address up and locks it; the URL reaches logs.
  it("keeps the invitation without its address", () => {
    expect(
      buildAuthPageUrl("/signup", {
        returnUrl: "/accept-invitation/inv_1",
        invitationId: "inv_1",
      }),
    ).toBe("/signup?returnUrl=%2Faccept-invitation%2Finv_1&invitationId=inv_1");
  });
});

describe("buildAuthPageUrl for sign-in", () => {
  it("returns bare signin path without an OAuth request or returnUrl", () => {
    expect(buildAuthPageUrl("/signin", {})).toBe("/signin");
  });

  it("carries the OAuth request as the sign-in page's own query", () => {
    expect(
      buildAuthPageUrl("/signin", {
        oauthQuery:
          "client_id=client_1&exp=1772367377&sig=mVXxByc5E32WEKh8YvwTBB%2BvbGZAR42ECbHJf8K%2F24s%3D",
      }),
    ).toBe(
      "/signin?client_id=client_1&exp=1772367377&sig=mVXxByc5E32WEKh8YvwTBB%2BvbGZAR42ECbHJf8K%2F24s%3D",
    );
  });
});

describe("buildOAuthResumeUrlFromSearchParams", () => {
  it.each<Record<string, string>>([
    { prompt: "login" },
    { prompt: "login consent" },
    { max_age: "300" },
    { max_age: "0" },
  ])("resumes explicit reauthentication at consent (%o)", (extra) => {
    const params = new URLSearchParams({
      client_id: "client_1",
      exp: "1772367377",
      ba_iat: "1772366777000",
      sig: "signed-value",
      ...extra,
    });

    expect(buildOAuthResumeUrlFromSearchParams(params)).toBe(
      `/oauth/consent?${params.toString()}`,
    );
  });

  it("keeps create requests on the sign-in hand-back path", () => {
    const params = new URLSearchParams({
      client_id: "cmo",
      exp: "1772367377",
      sig: "signed-value",
      prompt: "create",
    });

    expect(buildOAuthResumeUrlFromSearchParams(params)).toBe(
      `/signin?${params.toString()}`,
    );
  });

  it("ignores unsigned reauthentication parameters", () => {
    const params = new URLSearchParams(
      "client_id=cmo&exp=1772367377&ba_param=ba_param&ba_param=client_id&ba_param=exp&sig=signed-value&prompt=login&max_age=0",
    );

    expect(buildOAuthResumeUrlFromSearchParams(params)).toBe(
      "/signin?client_id=cmo&exp=1772367377&ba_param=ba_param&ba_param=client_id&ba_param=exp&sig=signed-value",
    );
  });

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
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /** Runs the wait to its end, through every timer it sets. */
  async function settle<T>(wait: Promise<T>): Promise<T> {
    await vi.runAllTimersAsync();
    return wait;
  }

  /**
   * Every sign-in path waits here and then navigates with `router.replace`, so
   * the document survives and a client the Ably singleton retired for a lost
   * session would survive with it. This is the one seam all four paths share.
   */
  it("discards a retired Ably client, because a sign-in just happened", async () => {
    // Every test in this block calls the seam, and nothing clears the
    // module-scoped mock, so the count would otherwise depend on test order.
    discardRetiredAblyRealtimeClient.mockClear();

    await settle(
      waitForAuthSession({
        context: "login",
        getSession: vi.fn().mockResolvedValue({ userId: "user_1" }),
        logWarning: vi.fn(),
      }),
    );
    // The import is dynamic and deliberately not awaited, so let it settle.
    vi.useRealTimers();
    await vi.waitFor(() => {
      expect(discardRetiredAblyRealtimeClient).toHaveBeenCalledOnce();
    });
  });

  it("asks once the cookie has had a moment, and returns the session", async () => {
    const getSession = vi.fn().mockResolvedValue({ userId: "user_1" });
    const logWarning = vi.fn();

    const wait = waitForAuthSession({
      context: "login",
      getSession,
      logWarning,
    });
    await vi.advanceTimersByTimeAsync(199);
    expect(getSession).not.toHaveBeenCalled();

    await expect(settle(wait)).resolves.toEqual({ userId: "user_1" });
    expect(getSession).toHaveBeenCalledTimes(1);
    expect(logWarning).not.toHaveBeenCalled();
  });

  it("retries once and logs waiting warning when first session check fails", async () => {
    const getSession = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ userId: "user_1" });
    const logWarning = vi.fn();

    const session = await settle(
      waitForAuthSession({ context: "signup", getSession, logWarning }),
    );

    expect(session).toEqual({ userId: "user_1" });
    expect(getSession).toHaveBeenCalledTimes(2);
    expect(logWarning).toHaveBeenCalledExactlyOnceWith(
      "Session not established after signup, waiting for 500ms",
    );
  });

  it("logs second warning when session is still unavailable after retry", async () => {
    const getSession = vi.fn().mockResolvedValue(null);
    const logWarning = vi.fn();

    const session = await settle(
      waitForAuthSession({ context: "login", getSession, logWarning }),
    );

    expect(session).toBeNull();
    expect(logWarning).toHaveBeenCalledTimes(2);
    expect(logWarning).toHaveBeenNthCalledWith(
      1,
      "Session not established after login, waiting for 500ms",
    );
    expect(logWarning).toHaveBeenNthCalledWith(
      2,
      "Session not established after login, proceeding with redirect anyway",
    );
  });

  it("treats a hung getSession as missing and continues", async () => {
    const getSession = vi.fn(() => new Promise(() => {}));
    const logWarning = vi.fn();

    const session = await settle(
      waitForAuthSession({ context: "login", getSession, logWarning }),
    );

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

describe("auth page URL round trips", () => {
  it.each(["/signup", "/signin"] as const)(
    "preserves signed multi-value OAuth parameters and an escaped return URL on %s",
    (path) => {
      const oauthQuery =
        "client_id=cmo&exp=1772367377&sig=abc%2Bdef%2Fghi%3D&scope=openid+email&ba_param=scope&ba_param=client_id";
      const returnUrl =
        "/accept-invitation/inv_1?next=%2Ftasks%3Fq%3Da%2Bb&tag=one&tag=two+words&literal=a+b#details";
      const url = new URL(
        buildAuthPageUrl(path, {
          oauthQuery,
          returnUrl,
          invitationId: "inv_1",
        }),
        "https://sokosumi.test",
      );
      expect(url.searchParams.get("returnUrl")).toBe(returnUrl);
      expect(url.searchParams.get("sig")).toBe("abc+def/ghi=");
      expect(url.searchParams.getAll("ba_param")).toEqual([
        "scope",
        "client_id",
      ]);
      expect(url.searchParams.get("scope")).toBe("openid email");
      expect(url.searchParams.has("email")).toBe(false);
      expect(url.searchParams.get("invitationId")).toBe("inv_1");
    },
  );
});
