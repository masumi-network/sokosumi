import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

interface BetterAuthApiErrorParseResult {
  data?: {
    body: {
      code: string;
      message: string;
    };
    status: string;
    statusCode: number;
  };
  success: boolean;
}

const signUpEmailMock = vi.fn();
const signInEmailMock = vi.fn();
const signInMagicLinkMock = vi.fn();
const setPasswordMock = vi.fn();
const handleUTMConversionMock = vi.fn();
const buildAuthRequestHeadersForForwardingMock = vi.fn();
const betterAuthApiErrorSafeParseMock = vi.fn<
  (value: unknown) => BetterAuthApiErrorParseResult
>(() => ({
  success: false,
}));

vi.mock("@/lib/auth/forward-cookies", () => ({
  buildAuthRequestHeadersForForwarding: () =>
    buildAuthRequestHeadersForForwardingMock(),
}));

vi.mock("@/lib/actions", () => ({
  AuthErrorCode: {
    EMAIL_DOMAIN_NOT_ALLOWED: "EMAIL_DOMAIN_NOT_ALLOWED",
    TERMS_NOT_ACCEPTED: "TERMS_NOT_ACCEPTED",
  },
  CommonErrorCode: {
    INTERNAL_SERVER_ERROR: "INTERNAL_SERVER_ERROR",
    BAD_INPUT: "BAD_INPUT",
  },
  betterAuthApiErrorSchema: {
    safeParse: betterAuthApiErrorSafeParseMock,
  },
}));

vi.mock("@/lib/auth/auth", () => ({
  auth: {
    api: {
      signUpEmail: signUpEmailMock,
      signInEmail: signInEmailMock,
      signInMagicLink: signInMagicLinkMock,
      setPassword: setPasswordMock,
    },
  },
}));

vi.mock("@/lib/services/utm.service", () => ({
  utmService: {
    handleUTMConversion: handleUTMConversionMock,
  },
}));

describe("auth actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    buildAuthRequestHeadersForForwardingMock.mockResolvedValue(new Headers());
    betterAuthApiErrorSafeParseMock.mockReturnValue({ success: false });
  });

  it("passes OAuth callback url during email signup", async () => {
    signUpEmailMock.mockResolvedValue({
      user: {
        id: "user-1",
      },
    });

    const { signUpEmail } = await import("../action");

    const result = await signUpEmail(
      {
        email: "new-user@example.com",
        name: "New User",
        password: "Passw0rd!",
        termsAccepted: true,
        marketingOptIn: false,
      },
      "/oauth/consent?client_id=test-client&redirect_uri=https%3A%2F%2Fhannah.sumike.ai%2Foauth%2Fcallback&code_challenge=test-challenge",
    );

    expect(result.ok).toBe(true);
    expect(signUpEmailMock).toHaveBeenCalledWith({
      body: expect.objectContaining({
        callbackURL:
          "/oauth/consent?client_id=test-client&redirect_uri=https%3A%2F%2Fhannah.sumike.ai%2Foauth%2Fcallback&code_challenge=test-challenge",
      }),
      headers: expect.any(Headers),
    });
  });

  it("returns OAuth redirect metadata when present", async () => {
    signUpEmailMock.mockResolvedValue({
      user: {
        id: "user-redirect",
      },
      redirect: true,
      url: "/api/auth/oauth2/authorize?client_id=test-client",
    });

    const { signUpEmail } = await import("../action");

    const result = await signUpEmail(
      {
        email: "redirect-user@example.com",
        name: "Redirect User",
        password: "Passw0rd!",
        termsAccepted: true,
        marketingOptIn: false,
      },
      "/oauth/consent?client_id=test-client&redirect_uri=https%3A%2F%2Fhannah.sumike.ai%2Foauth%2Fcallback&code_challenge=test-challenge",
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.user).toEqual({
      id: "user-redirect",
    });
    expect(result.data.redirect).toBe(true);
    expect(result.data.redirectUrl).toBe(
      "/api/auth/oauth2/authorize?client_id=test-client",
    );
  });

  it("falls back to root callback for unsafe callback urls", async () => {
    signUpEmailMock.mockResolvedValue({
      user: {
        id: "user-2",
      },
    });

    const { signUpEmail } = await import("../action");

    const result = await signUpEmail(
      {
        email: "new-user-2@example.com",
        name: "New User Two",
        password: "Passw0rd!",
        termsAccepted: true,
        marketingOptIn: false,
      },
      "https://evil.example.com/steal",
    );

    expect(result.ok).toBe(true);
    expect(signUpEmailMock).toHaveBeenCalledWith({
      body: expect.objectContaining({
        callbackURL: "/",
      }),
      headers: expect.any(Headers),
    });
  });

  it("returns OAuth redirect metadata when Better Auth nests it under data", async () => {
    signUpEmailMock.mockResolvedValue({
      user: {
        id: "user-redirect-nested",
      },
      data: {
        redirect: true,
        url: "/api/auth/oauth2/authorize?client_id=nested-client",
      },
    });

    const { signUpEmail } = await import("../action");

    const result = await signUpEmail(
      {
        email: "nested-redirect-user@example.com",
        name: "Nested Redirect User",
        password: "Passw0rd!",
        termsAccepted: true,
        marketingOptIn: false,
      },
      "/oauth/consent?client_id=nested-client&redirect_uri=https%3A%2F%2Fhannah.sumike.ai%2Foauth%2Fcallback&code_challenge=test-challenge",
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.redirect).toBe(true);
    expect(result.data.redirectUrl).toBe(
      "/api/auth/oauth2/authorize?client_id=nested-client",
    );
  });

  it("simulates original oauth flow failure and confirms headers prevent missing oauth query", async () => {
    signUpEmailMock.mockImplementation(({ headers }) => {
      const headerBag = headers as Headers | undefined;
      const hasCookieHeader = Boolean(headerBag?.get("cookie"));

      if (!hasCookieHeader) {
        throw {
          body: {
            code: "invalid_request",
            message: "missing oauth query",
          },
        };
      }

      return Promise.resolve({
        user: {
          id: "oauth-user",
        },
        redirect: true,
        url: "/api/auth/oauth2/authorize?client_id=test-client&state=test-state",
      });
    });

    const cookieHeaders = new Headers();
    cookieHeaders.set("cookie", "session_token=fake-session");
    buildAuthRequestHeadersForForwardingMock.mockResolvedValue(cookieHeaders);

    const { signUpEmail } = await import("../action");

    const result = await signUpEmail(
      {
        email: "oauth-flow@example.com",
        name: "OAuth Flow User",
        password: "Passw0rd!",
        termsAccepted: true,
        marketingOptIn: false,
      },
      "/oauth/consent?client_id=test-client&redirect_uri=https%3A%2F%2Fconsumer.example.com%2Fcallback&code_challenge=test-challenge&state=test-state&response_type=code",
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.redirect).toBe(true);
    expect(result.data.redirectUrl).toContain(
      "/api/auth/oauth2/authorize?client_id=test-client",
    );
    expect(signUpEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        headers: cookieHeaders,
      }),
    );
  });

  it("returns redirect metadata for sign-in when Better Auth returns oauth redirect payload", async () => {
    signInEmailMock.mockResolvedValue({
      redirect: true,
      url: "https://hannah.sumike.ai/oauth/sokosumi/callback?code=test-code",
    });

    const { signInEmail } = await import("../action");

    const result = await signInEmail({
      email: "login-user@example.com",
      currentPassword: "Passw0rd!",
      rememberMe: true,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.redirect).toBe(true);
    expect(result.data.redirectUrl).toBe(
      "https://hannah.sumike.ai/oauth/sokosumi/callback?code=test-code",
    );
    expect(signInEmailMock).toHaveBeenCalledWith({
      body: {
        email: "login-user@example.com",
        password: "Passw0rd!",
        rememberMe: true,
        callbackURL: "/",
      },
      headers: expect.any(Headers),
    });
  });

  it("passes OAuth callback url during email sign-in", async () => {
    signInEmailMock.mockResolvedValue({});

    const { signInEmail } = await import("../action");

    const result = await signInEmail(
      {
        email: "oauth-login-user@example.com",
        currentPassword: "Passw0rd!",
        rememberMe: true,
      },
      "/oauth/consent?client_id=test-client&redirect_uri=https%3A%2F%2Fconsumer.example.com%2Fcallback&code_challenge=test-challenge&state=test-state&response_type=code&exp=1772367377&sig=test-signature",
    );

    expect(result.ok).toBe(true);
    expect(signInEmailMock).toHaveBeenCalledWith({
      body: {
        email: "oauth-login-user@example.com",
        password: "Passw0rd!",
        rememberMe: true,
        callbackURL:
          "/oauth/consent?client_id=test-client&redirect_uri=https%3A%2F%2Fconsumer.example.com%2Fcallback&code_challenge=test-challenge&state=test-state&response_type=code&exp=1772367377&sig=test-signature",
      },
      headers: expect.any(Headers),
    });
  });

  it("falls back to root callback for unsafe sign-in callback urls", async () => {
    signInEmailMock.mockResolvedValue({});

    const { signInEmail } = await import("../action");

    const result = await signInEmail(
      {
        email: "unsafe-login-user@example.com",
        currentPassword: "Passw0rd!",
        rememberMe: false,
      },
      "https://evil.example.com/steal",
    );

    expect(result.ok).toBe(true);
    expect(signInEmailMock).toHaveBeenCalledWith({
      body: {
        email: "unsafe-login-user@example.com",
        password: "Passw0rd!",
        rememberMe: false,
        callbackURL: "/",
      },
      headers: expect.any(Headers),
    });
  });

  it("falls back to root callback for protocol-relative sign-in callback urls", async () => {
    signInEmailMock.mockResolvedValue({});

    const { signInEmail } = await import("../action");

    const result = await signInEmail(
      {
        email: "protocol-relative-login-user@example.com",
        currentPassword: "Passw0rd!",
        rememberMe: false,
      },
      "//evil.example.com/steal",
    );

    expect(result.ok).toBe(true);
    expect(signInEmailMock).toHaveBeenCalledWith({
      body: {
        email: "protocol-relative-login-user@example.com",
        password: "Passw0rd!",
        rememberMe: false,
        callbackURL: "/",
      },
      headers: expect.any(Headers),
    });
  });

  it("returns non-redirect success for sign-in when auth response has no oauth redirect", async () => {
    signInEmailMock.mockResolvedValue({});

    const { signInEmail } = await import("../action");

    const result = await signInEmail({
      email: "login-user@example.com",
      currentPassword: "Passw0rd!",
      rememberMe: false,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.redirect).toBe(false);
    expect(result.data.redirectUrl).toBeUndefined();
    expect(signInEmailMock).toHaveBeenCalledWith({
      body: {
        email: "login-user@example.com",
        password: "Passw0rd!",
        rememberMe: false,
        callbackURL: "/",
      },
      headers: expect.any(Headers),
    });
  });

  it("maps Better Auth sign-in error response to ActionError", async () => {
    betterAuthApiErrorSafeParseMock.mockReturnValue({
      success: true,
      data: {
        status: "BAD_REQUEST",
        statusCode: 400,
        body: {
          code: "TERMS_NOT_ACCEPTED",
          message: "Terms must be accepted before signing in",
        },
      },
    });

    signInEmailMock.mockRejectedValue({
      status: "BAD_REQUEST",
      statusCode: 400,
      body: {
        code: "TERMS_NOT_ACCEPTED",
        message: "Terms must be accepted before signing in",
      },
    });

    const { signInEmail } = await import("../action");

    const result = await signInEmail({
      email: "login-user@example.com",
      currentPassword: "Passw0rd!",
      rememberMe: false,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error).toEqual({
      code: "TERMS_NOT_ACCEPTED",
      message: "Terms must be accepted before signing in",
    });
  });

  it("returns bad input when magic-link sign-in email is invalid", async () => {
    const { requestMagicLinkSignIn } = await import("../action");

    const result = await requestMagicLinkSignIn("not-an-email");

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error).toEqual({
      code: "BAD_INPUT",
    });
    expect(signInMagicLinkMock).not.toHaveBeenCalled();
  });

  it("sends magic-link sign-in requests with a safe callback url", async () => {
    signInMagicLinkMock.mockResolvedValue({
      status: true,
    });

    const { requestMagicLinkSignIn } = await import("../action");

    const result = await requestMagicLinkSignIn(
      "login-user@example.com",
      "/oauth/consent?client_id=test-client&state=test-state",
    );

    expect(result.ok).toBe(true);
    expect(signInMagicLinkMock).toHaveBeenCalledWith({
      body: {
        email: "login-user@example.com",
        callbackURL: "/oauth/consent?client_id=test-client&state=test-state",
      },
      headers: expect.any(Headers),
    });
  });

  it("falls back to root callback for unsafe magic-link callback urls", async () => {
    signInMagicLinkMock.mockResolvedValue({
      status: true,
    });

    const { requestMagicLinkSignIn } = await import("../action");

    const result = await requestMagicLinkSignIn(
      "login-user@example.com",
      "https://evil.example.com/steal",
    );

    expect(result.ok).toBe(true);
    expect(signInMagicLinkMock).toHaveBeenCalledWith({
      body: {
        email: "login-user@example.com",
        callbackURL: "/",
      },
      headers: expect.any(Headers),
    });
  });

  it("sends a magic-link email even when the email is not registered yet", async () => {
    signInMagicLinkMock.mockResolvedValue({
      status: true,
    });

    const { requestMagicLinkSignIn } = await import("../action");

    const result = await requestMagicLinkSignIn(
      "missing-user@example.com",
      "/agents",
    );

    expect(result.ok).toBe(true);
    expect(signInMagicLinkMock).toHaveBeenCalledWith({
      body: {
        email: "missing-user@example.com",
        callbackURL: "/agents",
      },
      headers: expect.any(Headers),
    });
  });
});
