import "@testing-library/jest-dom";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import SignUpForm from "../form";

const mockReplace = jest.fn();
const mockSignUpEmail = jest.fn();
const mockGetSession = jest.fn();
const mockWaitForAuthSession = jest.fn().mockResolvedValue(undefined);

let mockSearchParams = new URLSearchParams();

jest.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: mockReplace,
  }),
  useSearchParams: () => mockSearchParams as unknown as URLSearchParams,
}));

jest.mock("next-intl", () => ({
  useTranslations: () => {
    const t = (key: string) => key;
    t.has = () => true;
    return t;
  },
}));

jest.mock("@vercel/analytics", () => ({
  track: jest.fn(),
}));

jest.mock("@sentry/nextjs", () => ({
  captureMessage: jest.fn(),
}));

jest.mock("sonner", () => ({
  toast: {
    success: jest.fn(),
    error: jest.fn(),
  },
}));

jest.mock("@/lib/actions", () => ({
  AuthErrorCode: {
    EMAIL_DOMAIN_NOT_ALLOWED: "EMAIL_DOMAIN_NOT_ALLOWED",
    TERMS_NOT_ACCEPTED: "TERMS_NOT_ACCEPTED",
  },
  signUpEmail: (...args: unknown[]) => mockSignUpEmail(...args),
}));

jest.mock("@/lib/auth/auth.client", () => ({
  authClient: {
    getSession: (...args: unknown[]) => mockGetSession(...args),
  },
}));

jest.mock("@/lib/gtm-events", () => ({
  fireGTMEvent: {
    viewRegisterArea: jest.fn(),
    registerFormStart: jest.fn(),
    signUp: jest.fn(),
  },
}));

jest.mock("@/lib/utils/auth-redirect", () => {
  const actual = jest.requireActual("@/lib/utils/auth-redirect");
  return {
    ...actual,
    waitForAuthSession: (...args: unknown[]) => mockWaitForAuthSession(...args),
  };
});

describe("SignUpForm OAuth workflow", () => {
  const originalLocation = window.location;

  beforeAll(() => {
    Object.defineProperty(window, "location", {
      configurable: true,
      value: {
        href: "http://localhost/",
        origin: "http://localhost",
      } as Location,
    });
  });

  afterAll(() => {
    Object.defineProperty(window, "location", {
      configurable: true,
      value: originalLocation,
    });
  });

  beforeEach(() => {
    mockReplace.mockReset();
    mockSignUpEmail.mockReset();
    mockGetSession.mockReset();
    mockWaitForAuthSession.mockReset();
    mockWaitForAuthSession.mockResolvedValue(undefined);
    mockSearchParams = new URLSearchParams();
    window.location.href = "http://localhost/";
  });

  async function submitValidSignUpForm() {
    const user = userEvent.setup();

    await user.type(
      screen.getByPlaceholderText("Fields.Name.placeholder"),
      "New User",
    );
    await user.type(
      screen.getByPlaceholderText("Fields.Email.placeholder"),
      "new-user@example.com",
    );
    await user.type(
      screen.getByPlaceholderText("Fields.Password.placeholder"),
      "Passw0rd!",
    );
    await user.type(
      screen.getByPlaceholderText("Fields.ConfirmPassword.placeholder"),
      "Passw0rd!",
    );
    await user.click(
      screen.getByRole("checkbox", {
        name: /Fields\.TermsAccepted\.Label\.iAgreeTo/,
      }),
    );
    await user.click(screen.getByRole("button", { name: "submit" }));
  }

  it("redirects with window.location.href when signup returns oauth redirect", async () => {
    mockSearchParams = new URLSearchParams({
      client_id: "test-client",
      redirect_uri: "https://consumer.example.com/callback",
      code_challenge: "test-challenge",
      code_challenge_method: "S256",
      scope: "openid offline_access",
      state: "test-state",
      response_type: "code",
      exp: "1772367377",
      sig: "signed-value",
    });

    mockSignUpEmail.mockResolvedValue({
      ok: true,
      data: {
        user: { id: "user-1" },
        redirect: true,
        redirectUrl: "/api/auth/oauth2/authorize?client_id=test-client",
      },
    });

    render(<SignUpForm />);

    await submitValidSignUpForm();

    await waitFor(() => {
      expect(window.location.href).toContain(
        "/api/auth/oauth2/authorize?client_id=test-client",
      );
    });

    expect(mockReplace).not.toHaveBeenCalled();
    expect(mockWaitForAuthSession).not.toHaveBeenCalled();
  });

  it("uses standard post-signup navigation when oauth redirect is not present", async () => {
    mockSignUpEmail.mockResolvedValue({
      ok: true,
      data: {
        user: { id: "user-2" },
      },
    });

    render(<SignUpForm />);

    await submitValidSignUpForm();

    await waitFor(() => {
      expect(mockWaitForAuthSession).toHaveBeenCalledTimes(1);
      expect(mockReplace).toHaveBeenCalledWith("/");
    });

    expect(window.location.href).toBe("http://localhost/");
  });

  it("passes unwrapped session data to waitForAuthSession after credential signup", async () => {
    mockSignUpEmail.mockResolvedValue({
      ok: true,
      data: {
        user: { id: "user-4" },
      },
    });
    mockGetSession.mockResolvedValueOnce({
      data: null,
      error: null,
    });

    render(<SignUpForm />);

    await submitValidSignUpForm();

    await waitFor(() => {
      expect(mockWaitForAuthSession).toHaveBeenCalledTimes(1);
    });

    const waitForAuthSessionOptions = mockWaitForAuthSession.mock
      .calls[0]?.[0] as {
      getSession: () => Promise<null | { id: string }>;
    };

    await expect(waitForAuthSessionOptions.getSession()).resolves.toBeNull();
  });

  it("passes oauth consent callback url built from search params", async () => {
    mockSearchParams = new URLSearchParams({
      client_id: "test-client",
      redirect_uri: "https://consumer.example.com/callback",
      code_challenge: "test-challenge",
      code_challenge_method: "S256",
      scope: "openid offline_access",
      state: "test-state",
      response_type: "code",
      exp: "1772367377",
      sig: "signed-value",
    });

    mockSignUpEmail.mockResolvedValue({
      ok: true,
      data: {
        user: { id: "user-3" },
        redirect: true,
        redirectUrl: "/api/auth/oauth2/authorize?client_id=test-client",
      },
    });

    render(<SignUpForm />);

    await submitValidSignUpForm();

    await waitFor(() => {
      expect(mockSignUpEmail).toHaveBeenCalledTimes(1);
    });

    const callbackUrl = mockSignUpEmail.mock.calls[0]?.[1];
    const submittedValues = mockSignUpEmail.mock.calls[0]?.[0];

    expect(submittedValues).toEqual(
      expect.objectContaining({
        name: "New User",
        email: "new-user@example.com",
        password: "Passw0rd!",
        confirmPassword: "Passw0rd!",
        termsAccepted: true,
        marketingOptIn: false,
      }),
    );

    expect(callbackUrl).toContain("/oauth/consent?");
    expect(callbackUrl).toContain("client_id=test-client");
    expect(callbackUrl).toContain(
      "redirect_uri=https%3A%2F%2Fconsumer.example.com%2Fcallback",
    );
    expect(callbackUrl).toContain("code_challenge=test-challenge");
    expect(callbackUrl).toContain("code_challenge_method=S256");
    expect(callbackUrl).toContain("scope=openid+offline_access");
    expect(callbackUrl).toContain("state=test-state");
    expect(callbackUrl).toContain("response_type=code");
    expect(callbackUrl).toContain("exp=1772367377");
    expect(callbackUrl).toContain("sig=signed-value");
  });
});
