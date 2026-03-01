export {};

jest.mock("server-only", () => ({}));

const signUpEmailMock = jest.fn();
const signInEmailMock = jest.fn();
const setPasswordMock = jest.fn();
const handleUTMConversionMock = jest.fn();
const headersMock = jest.fn();
const betterAuthApiErrorSafeParseMock = jest.fn(() => ({ success: false }));

jest.mock("next/headers", () => ({
  headers: headersMock,
}));

jest.mock("@/lib/actions", () => ({
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

jest.mock("@/lib/auth/auth", () => ({
  auth: {
    api: {
      signUpEmail: signUpEmailMock,
      signInEmail: signInEmailMock,
      setPassword: setPasswordMock,
    },
  },
}));

jest.mock("@/lib/services/utm.service", () => ({
  utmService: {
    handleUTMConversion: handleUTMConversionMock,
  },
}));

describe("auth actions", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    headersMock.mockResolvedValue(new Headers());
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
        confirmPassword: "Passw0rd!",
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
        confirmPassword: "Passw0rd!",
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
        confirmPassword: "Passw0rd!",
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
        confirmPassword: "Passw0rd!",
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
    headersMock.mockResolvedValue(cookieHeaders);

    const { signUpEmail } = await import("../action");

    const result = await signUpEmail(
      {
        email: "oauth-flow@example.com",
        name: "OAuth Flow User",
        password: "Passw0rd!",
        confirmPassword: "Passw0rd!",
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
});
