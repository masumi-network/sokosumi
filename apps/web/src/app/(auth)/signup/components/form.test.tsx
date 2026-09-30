import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
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
import {
  captchaErrorMessageMock,
  requestCaptchaMock,
} from "@/test/auth-captcha-mock";

import SignUpForm from "./form";

const mockReplace = vi.fn();
const mockLocationReplace = vi.fn();
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

vi.mock("@/lib/actions/errors/error-codes/auth", () => ({
  AuthErrorCode: {
    EMAIL_DOMAIN_NOT_ALLOWED: "EMAIL_DOMAIN_NOT_ALLOWED",
    TERMS_NOT_ACCEPTED: "TERMS_NOT_ACCEPTED",
  },
}));

vi.mock("@/lib/actions/auth/action", () => ({
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
        replace: (...args: unknown[]) => mockLocationReplace(...args),
      } as unknown as Location,
    });
  });

  afterAll(() => {
    Object.defineProperty(window, "location", {
      configurable: true,
      value: originalLocation,
    });
  });

  const onFormStart = vi.fn();

  function renderForm() {
    return render(
      <SignUpForm
        email="new-user@example.com"
        onFormStart={onFormStart}
        onPendingChange={vi.fn()}
      />,
    );
  }

  beforeEach(() => {
    onFormStart.mockReset();
    mockReplace.mockReset();
    mockLocationReplace.mockReset();
    mockSignUpEmail.mockReset();
    mockHandleUtmConversion.mockReset();
    mockGetSession.mockReset();
    mockWaitForAuthSession.mockReset();
    mockWaitForAuthSession.mockResolvedValue(undefined);
    mockSearchParams = new URLSearchParams();
    window.location.href = "http://localhost/";
  });

  async function submitSignUpForm(password: string) {
    const user = userEvent.setup();

    await user.type(screen.getByLabelText("Fields.FirstName.label"), "New");
    await user.type(screen.getByLabelText("Fields.LastName.label"), "User");
    await user.type(screen.getByLabelText("Fields.Password.label"), password);
    await user.click(screen.getByRole("button", { name: "submit" }));
  }

  function submitValidSignUpForm() {
    return submitSignUpForm("Passw0rd!");
  }

  it("asks for name and password, with updates as the only checkbox", () => {
    renderForm();

    expect(screen.getAllByRole("checkbox")).toHaveLength(1);
    expect(
      screen.getByRole("checkbox", { name: "Fields.MarketingOptIn.label" }),
    ).not.toBeChecked();
    expect(screen.getByRole("button", { name: "submit" })).toBeEnabled();
  });

  it("lets a password manager recognise names, email and new password", () => {
    const { container } = renderForm();

    expect(screen.getByLabelText("Fields.FirstName.label")).toHaveAttribute(
      "autocomplete",
      "given-name",
    );
    expect(screen.getByLabelText("Fields.LastName.label")).toHaveAttribute(
      "autocomplete",
      "family-name",
    );
    expect(screen.getByLabelText("Fields.Password.label")).toHaveAttribute(
      "autocomplete",
      "new-password",
    );
    // The email was confirmed on the step before. It is not asked again, but
    // the new password still has to be saved against it.
    expect(screen.queryByTestId("auth-field-email")).not.toBeInTheDocument();
    const username = container.querySelector('input[autocomplete="username"]');
    expect(username).toHaveValue("new-user@example.com");
    expect(username).toHaveAttribute("readonly");
    expect(username).toHaveAttribute("aria-hidden", "true");
    expect(username).toHaveAttribute("type", "email");
    expect(username).toHaveAttribute("autocapitalize", "none");
    expect(username).toHaveAttribute("spellcheck", "false");
  });

  it("moves focus to the first name when the step opens", async () => {
    renderForm();

    // react-hook-form defers the focus by a tick.
    await waitFor(() => {
      expect(screen.getByLabelText("Fields.FirstName.label")).toHaveFocus();
    });
  });

  it("reports the first input to the flow", async () => {
    const user = userEvent.setup();
    renderForm();
    expect(onFormStart).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText("Fields.FirstName.label"), "N");

    expect(onFormStart).toHaveBeenCalled();
  });

  it("accepts a lower-case password of eight characters and sends the terms acceptance", async () => {
    mockSignUpEmail.mockResolvedValue({
      data: { user: { id: "user-1" } },
      error: null,
    });
    renderForm();

    await submitSignUpForm("abcdefgh");

    await waitFor(() => {
      expect(mockSignUpEmail).toHaveBeenCalledTimes(1);
    });
    expect(mockSignUpEmail.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        password: "abcdefgh",
        termsAccepted: true,
        marketingOptIn: false,
      }),
    );
  });

  it("rejects a password of seven characters with the stated rule", async () => {
    renderForm();

    await submitSignUpForm("abcdefg");

    expect(await screen.findByText("Password.min")).toBeInTheDocument();
    // The rule reaches a screen reader through the field's description.
    expect(
      screen.getByLabelText("Fields.Password.label"),
    ).toHaveAccessibleDescription("Password.min");
    expect(mockSignUpEmail).not.toHaveBeenCalled();
  });

  it("shows translated captcha errors from Core", async () => {
    const error = {
      code: "VERIFICATION_FAILED",
      message: "Captcha verification failed",
    };
    mockSignUpEmail.mockResolvedValueOnce({ data: null, error });
    captchaErrorMessageMock.mockReturnValue("Translated captcha error");
    renderForm();

    await submitValidSignUpForm();

    expect(captchaErrorMessageMock).toHaveBeenCalledWith(error, error.message);
    expect(toast.error).toHaveBeenLastCalledWith("Translated captcha error");
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("says to start again when the OAuth request has expired", async () => {
    mockSignUpEmail.mockResolvedValueOnce({
      data: null,
      error: { status: 400, error: "invalid_signature" },
    });
    renderForm();

    await submitValidSignUpForm();

    await waitFor(() => {
      expect(toast.error).toHaveBeenLastCalledWith("errorDescription");
    });
    expect(mockLocationReplace).not.toHaveBeenCalled();
  });

  it("does not register when verification is cancelled", async () => {
    requestCaptchaMock.mockResolvedValueOnce(null);
    renderForm();
    await submitValidSignUpForm();
    expect(mockSignUpEmail).not.toHaveBeenCalled();
  });

  it("renders signup with a single password field", () => {
    renderForm();

    expect(
      screen.queryByLabelText("Fields.ConfirmPassword.label"),
    ).not.toBeInTheDocument();
    expect(screen.getByLabelText("Fields.Password.label")).toHaveAttribute(
      "type",
      "password",
    );
  });

  it("counts the signup in place and leaves with a full document load", async () => {
    mockSignUpEmail.mockResolvedValue({
      data: {
        user: { id: "user-2" },
      },
      error: null,
    });
    mockWaitForAuthSession.mockResolvedValue({ id: "session-1" });

    renderForm();

    await submitValidSignUpForm();

    await waitFor(() => {
      expect(mockWaitForAuthSession).toHaveBeenCalledTimes(1);
      expect(mockLocationReplace).toHaveBeenCalledWith("/");
      expect(mockHandleUtmConversion).toHaveBeenCalledTimes(1);
    });

    const signUpPayload = mockSignUpEmail.mock.calls[0]?.[0] as Record<
      string,
      unknown
    >;
    expect(signUpPayload).not.toHaveProperty("callbackURL");
    expect(fireGTMEvent.signUp).toHaveBeenCalledWith("credential");
    // A soft nav would be served the pre-signup middleware redirect.
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("does not count a signup when no session appears", async () => {
    mockSignUpEmail.mockResolvedValue({
      data: {
        user: { id: "user-3" },
      },
      error: null,
    });
    mockWaitForAuthSession.mockResolvedValue(null);

    renderForm();

    await submitValidSignUpForm();

    await waitFor(() => {
      expect(mockLocationReplace).toHaveBeenCalledWith("/");
    });
    expect(fireGTMEvent.signUp).not.toHaveBeenCalled();
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

    renderForm();

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

  it("leaves the navigation to the OAuth provider when the page carries an OAuth request", async () => {
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
        redirect: true,
        url: "https://consumer.example.com/callback?code=abc",
      },
      error: null,
    });
    mockWaitForAuthSession.mockResolvedValue({ id: "session-1" });

    renderForm();

    await submitValidSignUpForm();

    await waitFor(() => {
      expect(mockSignUpEmail).toHaveBeenCalledTimes(1);
    });

    const signUpPayload = mockSignUpEmail.mock.calls[0]?.[0];

    expect(signUpPayload).toEqual(
      expect.objectContaining({
        firstName: "New",
        lastName: "User",
        name: "New User",
        email: "new-user@example.com",
        password: "Passw0rd!",
        termsAccepted: true,
        marketingOptIn: false,
      }),
    );
    expect(signUpPayload).not.toHaveProperty("onboardingCompleted");

    expect(signUpPayload).not.toHaveProperty("callbackURL");

    await waitFor(() => {
      expect(fireGTMEvent.signUp).toHaveBeenCalledWith("credential");
      expect(mockHandleUtmConversion).toHaveBeenCalledTimes(1);
    });
    // Better Auth's client follows the provider's answer. A second
    // navigation would deliver the authorization code twice.
    expect(mockLocationReplace).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("keeps a left-edge submit spinner after credential signup succeeds", async () => {
    mockSignUpEmail.mockResolvedValue({
      data: {
        user: { id: "user-5" },
      },
      error: null,
    });

    renderForm();

    await submitValidSignUpForm();

    await waitFor(() => {
      expect(mockLocationReplace).toHaveBeenCalledTimes(1);
    });

    const submitButton = screen.getByRole("button", { name: "submit" });
    const spinner = submitButton.querySelector("svg.animate-spin");

    expect(submitButton).toBeDisabled();
    expect(spinner).not.toBeNull();
    expect(spinner).toHaveClass(
      "absolute",
      "top-1/2",
      "left-4",
      "-translate-y-1/2",
    );
  });

  it("releases the submit spinner after credential signup fails", async () => {
    mockSignUpEmail.mockResolvedValue({
      data: null,
      error: { message: "Email already in use" },
    });

    renderForm();

    await submitValidSignUpForm();

    const submitButton = screen.getByRole("button", { name: "submit" });

    await waitFor(() => {
      expect(submitButton).toBeEnabled();
    });

    expect(submitButton.querySelector("svg.animate-spin")).toBeNull();
  });
});

vi.mock("@/components/auth-captcha", () => import("@/test/auth-captcha-mock"));
