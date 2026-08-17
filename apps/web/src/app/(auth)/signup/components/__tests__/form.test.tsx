import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import SignUpForm from "../form";

const mockReplace = vi.fn();
const mockSignUpEmail = vi.fn();
const mockHandleUtmConversion = vi.fn();
const mockGetSession = vi.fn();
const mockWaitForAuthSession = vi.fn().mockResolvedValue(undefined);

let mockSearchParams = new URLSearchParams();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: mockReplace,
  }),
  useSearchParams: () => mockSearchParams as unknown as URLSearchParams,
}));

vi.mock("next-intl", () => ({
  useTranslations: () => {
    const t = (key: string) => key;
    t.has = () => true;
    return t;
  },
}));

vi.mock("@vercel/analytics", () => ({
  track: vi.fn(),
}));

vi.mock("@sentry/nextjs", () => ({
  captureMessage: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("@/lib/actions", () => ({
  AuthErrorCode: {
    EMAIL_DOMAIN_NOT_ALLOWED: "EMAIL_DOMAIN_NOT_ALLOWED",
    TERMS_NOT_ACCEPTED: "TERMS_NOT_ACCEPTED",
  },
}));

vi.mock("@/lib/actions/auth", () => ({
  handleUtmConversion: (...args: unknown[]) => mockHandleUtmConversion(...args),
}));

vi.mock("@/lib/auth/auth.client", () => ({
  authClient: {
    getSession: (...args: unknown[]) => mockGetSession(...args),
  },
  signUp: {
    email: (...args: unknown[]) => mockSignUpEmail(...args),
  },
}));

vi.mock("@/lib/gtm-events", () => ({
  fireGTMEvent: {
    viewRegisterArea: vi.fn(),
    registerFormStart: vi.fn(),
    signUp: vi.fn(),
  },
}));

vi.mock("@/lib/auth/auth.utils", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth/auth.utils")>(
    "@/lib/auth/auth.utils",
  );
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
    mockHandleUtmConversion.mockReset();
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
    await user.click(
      screen.getByRole("checkbox", {
        name: /Fields\.TermsAccepted\.Label\.iAgreeTo/,
      }),
    );
    await user.click(screen.getByRole("button", { name: "submit" }));
  }

  it("renders signup with a single password field", () => {
    render(<SignUpForm />);

    expect(
      screen.queryByPlaceholderText("Fields.ConfirmPassword.placeholder"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByPlaceholderText("Fields.Name.placeholder"),
    ).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText("Fields.Password.placeholder"),
    ).toHaveAttribute("type", "password");
  });

  it("redirects with window.location.href when signup returns oauth redirect", async () => {
    mockSearchParams = new URLSearchParams({
      client_id: "test-client",
      redirect_uri: "https://consumer.example.com/callback",
      code_challenge: "test-challenge",
      code_challenge_method: "S256",
      scope: "openid",
      state: "test-state",
      response_type: "code",
      exp: "1772367377",
      sig: "signed-value",
    });

    mockSignUpEmail.mockResolvedValue({
      data: {
        user: { id: "user-1" },
        redirect: true,
        url: "/auth/oauth2/authorize?client_id=test-client",
      },
      error: null,
    });

    render(<SignUpForm />);

    await submitValidSignUpForm();

    await waitFor(() => {
      expect(window.location.href).toContain(
        "/auth/oauth2/authorize?client_id=test-client",
      );
    });

    expect(mockReplace).not.toHaveBeenCalled();
    expect(mockWaitForAuthSession).not.toHaveBeenCalled();
  });

  it("uses standard post-signup navigation when oauth redirect is not present", async () => {
    mockSignUpEmail.mockResolvedValue({
      data: {
        user: { id: "user-2" },
      },
      error: null,
    });

    render(<SignUpForm />);

    await submitValidSignUpForm();

    await waitFor(() => {
      expect(mockWaitForAuthSession).toHaveBeenCalledTimes(1);
      expect(mockReplace).toHaveBeenCalledWith("/");
      expect(mockHandleUtmConversion).toHaveBeenCalledTimes(1);
    });

    expect(window.location.href).toBe("http://localhost/");
  });

  it("passes unwrapped session data to waitForAuthSession after credential signup", async () => {
    mockSignUpEmail.mockResolvedValue({
      data: {
        user: { id: "user-4" },
      },
      error: null,
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
      scope: "openid",
      state: "test-state",
      response_type: "code",
      exp: "1772367377",
      sig: "signed-value",
    });

    mockSignUpEmail.mockResolvedValue({
      data: {
        user: { id: "user-3" },
        redirect: true,
        url: "/auth/oauth2/authorize?client_id=test-client",
      },
      error: null,
    });

    render(<SignUpForm />);

    await submitValidSignUpForm();

    await waitFor(() => {
      expect(mockSignUpEmail).toHaveBeenCalledTimes(1);
    });

    const signUpPayload = mockSignUpEmail.mock.calls[0]?.[0];

    expect(signUpPayload).toEqual(
      expect.objectContaining({
        name: "New User",
        email: "new-user@example.com",
        password: "Passw0rd!",
        termsAccepted: true,
        marketingOptIn: false,
      }),
    );
    expect(signUpPayload).not.toHaveProperty("onboardingCompleted");

    expect(signUpPayload.callbackURL).toContain("/oauth/consent?");
    expect(signUpPayload.callbackURL).toContain("client_id=test-client");
    expect(signUpPayload.callbackURL).toContain(
      "redirect_uri=https%3A%2F%2Fconsumer.example.com%2Fcallback",
    );
    expect(signUpPayload.callbackURL).toContain(
      "code_challenge=test-challenge",
    );
    expect(signUpPayload.callbackURL).toContain("code_challenge_method=S256");
    expect(signUpPayload.callbackURL).toContain("scope=openid");
    expect(signUpPayload.callbackURL).toContain("state=test-state");
    expect(signUpPayload.callbackURL).toContain("response_type=code");
    expect(signUpPayload.callbackURL).toContain("exp=1772367377");
    expect(signUpPayload.callbackURL).toContain("sig=signed-value");
  });
});
