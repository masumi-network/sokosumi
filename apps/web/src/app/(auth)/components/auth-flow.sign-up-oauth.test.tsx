import { act, render, screen, waitFor } from "@testing-library/react";
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

import { fireGTMEvent } from "@/lib/gtm-events";

import AuthFlow from "./auth-flow";

// The two steps together, unmocked, on a page that carries a Sign in with
// Sokosumi request. Core's OAuth provider answers a sign-up from such a page
// itself; the steps must neither lose the request nor navigate over its
// answer.

const OAUTH_SEARCH = new URLSearchParams({
  client_id: "cmo",
  redirect_uri: "https://app.cmo.xyz/api/auth/callback/sokosumi",
  code_challenge: "test-challenge",
  exp: "1772367377",
  sig: "signed-value",
});

const routerReplaceMock = vi.fn();
const routerPushMock = vi.fn();
const locationReplaceMock = vi.fn();
const signUpEmailMock = vi.fn();
const emailStatusMock = vi.fn();
const handleUtmConversionMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: routerReplaceMock, push: routerPushMock }),
  useSearchParams: () => OAUTH_SEARCH,
}));

vi.mock("next-intl", () => ({
  useTranslations: () => {
    const t = (key: string) => key;
    t.has = () => true;
    return t;
  },
}));

vi.mock("@vercel/analytics", () => ({ track: vi.fn() }));
vi.mock("@sentry/nextjs", () => ({ captureMessage: vi.fn() }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

vi.mock("@/lib/actions/auth/action", () => ({
  handleUtmConversion: (...args: unknown[]) => handleUtmConversionMock(...args),
}));

vi.mock("@/lib/auth/auth.client", () => ({
  authClient: {
    $fetch: (...args: unknown[]) => emailStatusMock(...args),
    getSession: vi.fn(),
    emailOtp: {
      sendVerificationOtp: vi
        .fn()
        .mockResolvedValue({ data: { success: true }, error: null }),
    },
    // A password sign-up goes through the email code.
    signIn: { emailOtp: (...args: unknown[]) => signUpEmailMock(...args) },
  },
}));

vi.mock("@/lib/gtm-events", () => ({
  fireGTMEvent: {
    viewRegisterArea: vi.fn(),
    registerFormStart: vi.fn(),
    signUp: vi.fn(),
  },
}));

vi.mock("@/auth/components/social-buttons", () => ({
  __esModule: true,
  default: () => <div data-testid="social-buttons" />,
}));

vi.mock("@/components/auth-captcha", () => import("@/test/auth-captcha-mock"));

describe("stepped sign-up with an OAuth request", () => {
  const originalLocation = window.location;

  beforeAll(() => {
    Object.defineProperty(window, "location", {
      configurable: true,
      value: {
        href: `http://localhost/signup?${OAUTH_SEARCH}`,
        origin: "http://localhost",
        search: `?${OAUTH_SEARCH}`,
        replace: (...args: unknown[]) => locationReplaceMock(...args),
      } as unknown as Location,
    });
  });

  afterAll(() => {
    Object.defineProperty(window, "location", {
      configurable: true,
      value: originalLocation,
    });
  });

  beforeEach(() => {
    vi.clearAllMocks();
    emailStatusMock.mockResolvedValue({
      data: { exists: false, hasPassword: false },
      error: null,
    });
  });

  it("reaches the second step without navigating, then leaves the redirect to the provider", async () => {
    const user = userEvent.setup();
    // What Core's OAuth provider returns once the sign-up created a session.
    signUpEmailMock.mockResolvedValue({
      data: {
        redirect: true,
        url: "https://app.cmo.xyz/api/auth/callback/sokosumi?code=abc",
      },
      error: null,
    });
    render(
      <AuthFlow
        mode="signUp"
        lastUsedMethod={null}
        client={{ name: "CMO", uri: undefined, logoUri: undefined }}
      />,
    );

    await user.type(screen.getByLabelText("label"), "ada@example.com");
    await user.click(screen.getByRole("button", { name: "continueWithEmail" }));
    await user.type(await screen.findByLabelText("firstNameLabel"), "Ada");

    // The step change is component state. The OAuth request lives in the page
    // URL, and the auth client reads it from there on every call, so a
    // navigation between the steps would drop it.
    expect(routerReplaceMock).not.toHaveBeenCalled();
    expect(routerPushMock).not.toHaveBeenCalled();
    expect(locationReplaceMock).not.toHaveBeenCalled();
    expect(window.location.search).toBe(`?${OAUTH_SEARCH}`);

    await user.type(screen.getByLabelText("lastNameLabel"), "Lovelace");
    await user.click(screen.getByRole("button", { name: "addPassword" }));
    await user.type(
      screen.getByLabelText("Fields.Password.label"),
      "Passw0rd!",
    );
    await user.type(
      screen.getByRole("textbox", { name: "codeLabel" }),
      "042917",
    );
    // The code waits for Register.
    await act(async () => {});
    expect(signUpEmailMock).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "submit" }));

    await waitFor(() => {
      expect(signUpEmailMock).toHaveBeenCalledTimes(1);
    });
    expect(signUpEmailMock.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        email: "ada@example.com",
        firstName: "Ada",
        lastName: "Lovelace",
        otp: "042917",
        password: "Passw0rd!",
        termsAccepted: true,
      }),
    );
    // No callbackURL: the provider's answer is the destination.
    expect(signUpEmailMock.mock.calls[0]?.[0]).not.toHaveProperty(
      "callbackURL",
    );

    await waitFor(() => {
      expect(fireGTMEvent.signUp).toHaveBeenCalledWith("credential");
      expect(handleUtmConversionMock).toHaveBeenCalledTimes(1);
    });
    // Better Auth's client follows the provider's answer. A second navigation
    // would deliver the authorization code twice.
    expect(locationReplaceMock).not.toHaveBeenCalled();
    expect(routerReplaceMock).not.toHaveBeenCalled();
  });
});
