export {};

jest.mock("server-only", () => ({}));

const signUpEmailMock = jest.fn();
const setPasswordMock = jest.fn();
const handleUTMConversionMock = jest.fn();

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
    safeParse: () => ({ success: false }),
  },
}));

jest.mock("@/lib/auth/auth", () => ({
  auth: {
    api: {
      signUpEmail: signUpEmailMock,
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
    });
  });
});
