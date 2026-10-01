import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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
import {
  rememberAuthEmailHint,
  takeAuthEmailHint,
} from "@/lib/auth/auth-email-hint";
import { fireGTMEvent } from "@/lib/gtm-events";
import {
  captchaErrorMessageMock,
  captchaFetchOptions,
  requestCaptchaMock,
} from "@/test/auth-captcha-mock";

import SignInForm from "./form";

const mockReplace = vi.fn();
const mockLocationReplace = vi.fn();
const mockSignInEmail = vi.fn();
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
    const translator = (key: string) => {
      if (key === "lastUsed") {
        return "last-used";
      }
      return key;
    };

    translator.has = (key: string) => key === "lastUsed";

    return translator;
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
    TERMS_NOT_ACCEPTED: "TERMS_NOT_ACCEPTED",
  },
}));

vi.mock("@/lib/actions/auth/action", () => ({}));

vi.mock("@/lib/auth/auth.client", () => ({
  authClient: {
    getSession: (...args: unknown[]) => mockGetSession(...args),
  },
  signIn: {
    email: (...args: unknown[]) => mockSignInEmail(...args),
  },
}));

vi.mock("@/lib/gtm-events", () => ({
  fireGTMEvent: {
    viewLoginArea: vi.fn(),
    loginAreaFormStart: vi.fn(),
    signIn: vi.fn(),
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

describe("SignInForm", () => {
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

  beforeEach(() => {
    mockReplace.mockReset();
    mockLocationReplace.mockReset();
    mockSignInEmail.mockReset();
    mockGetSession.mockReset();
    mockWaitForAuthSession.mockReset();
    mockWaitForAuthSession.mockResolvedValue(undefined);
    mockSearchParams = new URLSearchParams();
    window.location.href = "http://localhost/";
    window.sessionStorage.clear();
  });

  async function submitValidSignInForm() {
    const user = userEvent.setup();

    await user.type(
      screen.getByPlaceholderText("Fields.Email.placeholder"),
      "login-user@example.com",
    );
    await user.type(
      screen.getByPlaceholderText("Fields.Password.placeholder"),
      "Passw0rd!",
    );
    await user.click(screen.getByRole("button", { name: "submit" }));
  }

  it("renders the email last-used inline marker inside the submit button", () => {
    render(<SignInForm isLastUsedEmailLogin />);

    const submitButton = screen.getByRole("button", { name: "submit" });
    const lastUsedLabel = screen.getByText("last-used");
    const badgeContainer = submitButton.parentElement;

    expect(lastUsedLabel).toBeInTheDocument();
    expect(lastUsedLabel).toHaveClass(
      "absolute",
      "top-1/2",
      "right-2",
      "-translate-y-1/2",
      "rounded-full",
      "border",
      "bg-background",
      "text-foreground",
      "border-border",
    );
    expect(badgeContainer).toHaveClass("relative");
    expect(badgeContainer).toContainElement(lastUsedLabel);
  });

  it("asks for the address with an email keyboard and no autocorrect", () => {
    render(<SignInForm />);

    const email = screen.getByTestId("auth-field-email");
    expect(email).toHaveAttribute("type", "email");
    expect(email).toHaveAttribute("autocomplete", "username webauthn");
    expect(email).toHaveAttribute("autocapitalize", "none");
    expect(email).toHaveAttribute("spellcheck", "false");
  });

  it("toggles the password field visibility", async () => {
    const user = userEvent.setup();

    render(<SignInForm />);

    const passwordField = screen.getByPlaceholderText(
      "Fields.Password.placeholder",
    ) as HTMLInputElement;

    await user.type(passwordField, "Passw0rd!");
    passwordField.focus();
    passwordField.setSelectionRange(4, 4);

    expect(passwordField).toHaveFocus();
    expect(passwordField.selectionStart).toBe(4);
    expect(passwordField.selectionEnd).toBe(4);
    expect(passwordField).toHaveAttribute("type", "password");

    await user.click(
      screen.getByRole("button", { name: "PasswordToggle.show" }),
    );

    await waitFor(() => {
      expect(passwordField).toHaveFocus();
      expect(passwordField.selectionStart).toBe(4);
      expect(passwordField.selectionEnd).toBe(4);
      expect(passwordField).toHaveAttribute("type", "text");
      expect(
        screen.getByRole("button", { name: "PasswordToggle.hide" }),
      ).toBeInTheDocument();
    });
  });

  it("starts from the email sign-up handed over, editable, with focus on the password", async () => {
    const user = userEvent.setup();
    rememberAuthEmailHint("ada@example.com");

    render(<SignInForm />);

    const email = screen.getByPlaceholderText("Fields.Email.placeholder");
    await waitFor(() => {
      expect(email).toHaveValue("ada@example.com");
      expect(
        screen.getByPlaceholderText("Fields.Password.placeholder"),
      ).toHaveFocus();
    });
    expect(email).toBeEnabled();

    await user.type(email, ".uk");
    expect(email).toHaveValue("ada@example.com.uk");
  });

  it("uses the handed-over email once", async () => {
    rememberAuthEmailHint("ada@example.com");
    const first = render(<SignInForm />);
    await waitFor(() => {
      expect(
        screen.getByPlaceholderText("Fields.Email.placeholder"),
      ).toHaveValue("ada@example.com");
    });
    first.unmount();

    render(<SignInForm />);

    expect(screen.getByPlaceholderText("Fields.Email.placeholder")).toHaveValue(
      "",
    );
  });

  it("keeps a locked invitation email over a handed-over one", () => {
    rememberAuthEmailHint("ada@example.com");

    render(<SignInForm prefilledEmail="invited@example.com" />);

    const email = screen.getByPlaceholderText("Fields.Email.placeholder");
    expect(email).toHaveValue("invited@example.com");
    expect(email).toBeDisabled();
  });

  it("focuses the password field when submit hits a missing password error", async () => {
    const user = userEvent.setup();

    render(<SignInForm />);

    await user.type(
      screen.getByPlaceholderText("Fields.Email.placeholder"),
      "login-user@example.com",
    );
    await user.click(screen.getByRole("button", { name: "submit" }));

    await waitFor(() => {
      expect(
        screen.getByPlaceholderText("Fields.Password.placeholder"),
      ).toHaveFocus();
    });
  });

  it("shows translated captcha errors from Core", async () => {
    const error = {
      code: "VERIFICATION_FAILED",
      message: "Captcha verification failed",
    };
    mockSignInEmail.mockResolvedValueOnce({ data: null, error });
    captchaErrorMessageMock.mockReturnValue("Translated captcha error");
    render(<SignInForm />);

    await submitValidSignInForm();

    expect(captchaErrorMessageMock).toHaveBeenCalledWith(error, error.message);
    expect(toast.error).toHaveBeenLastCalledWith("Translated captcha error");
    expect(mockLocationReplace).not.toHaveBeenCalled();
  });

  it("passes the verified captcha token to credential sign-in", async () => {
    mockSignInEmail.mockResolvedValue({ data: {}, error: null });
    render(<SignInForm />);

    await submitValidSignInForm();

    expect(requestCaptchaMock).toHaveBeenCalledOnce();
    expect(mockSignInEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        fetchOptions: captchaFetchOptions,
      }),
    );
  });

  it("releases submit without signing in when the captcha is cancelled", async () => {
    requestCaptchaMock.mockResolvedValueOnce(null);
    render(<SignInForm />);

    await submitValidSignInForm();

    expect(requestCaptchaMock).toHaveBeenCalledOnce();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "submit" })).toBeEnabled(),
    );
    expect(mockSignInEmail).not.toHaveBeenCalled();
    expect(mockWaitForAuthSession).not.toHaveBeenCalled();
    expect(mockLocationReplace).not.toHaveBeenCalled();
  });

  it("passes unwrapped session data to waitForAuthSession after credential login", async () => {
    mockSignInEmail.mockResolvedValue({
      data: {},
      error: null,
    });
    mockGetSession.mockResolvedValueOnce({
      data: null,
      error: null,
    });

    render(<SignInForm />);

    await submitValidSignInForm();

    await waitFor(() => {
      expect(mockWaitForAuthSession).toHaveBeenCalledTimes(1);
    });

    const waitForAuthSessionOptions = mockWaitForAuthSession.mock
      .calls[0]?.[0] as {
      getSession: () => Promise<null | { id: string }>;
    };

    await expect(waitForAuthSessionOptions.getSession()).resolves.toBeNull();
  });

  it("fires login in place and leaves for returnUrl without a callback page", async () => {
    mockSignInEmail.mockResolvedValue({
      data: {},
      error: null,
    });
    mockWaitForAuthSession.mockResolvedValue({ id: "session-1" });

    render(<SignInForm returnUrl="/chat" />);

    await submitValidSignInForm();

    await waitFor(() => {
      expect(mockLocationReplace).toHaveBeenCalledWith("/chat");
    });

    const payload = mockSignInEmail.mock.calls[0]?.[0] as Record<
      string,
      unknown
    >;
    expect(payload).not.toHaveProperty("callbackURL");
    expect(fireGTMEvent.signIn).toHaveBeenCalledWith("credential");
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("leaves the navigation to the OAuth provider when the page carries an OAuth request", async () => {
    mockSearchParams = new URLSearchParams({
      client_id: "cmo",
      exp: "1772367377",
      sig: "signed-value",
    });
    mockSignInEmail.mockResolvedValue({
      data: {
        redirect: true,
        url: "https://app.cmo.xyz/api/auth/callback/sokosumi?code=abc",
      },
      error: null,
    });
    mockWaitForAuthSession.mockResolvedValue({ id: "session-1" });

    render(<SignInForm />);

    await submitValidSignInForm();

    await waitFor(() => {
      expect(fireGTMEvent.signIn).toHaveBeenCalledWith("credential");
    });
    // Better Auth's client follows the provider's answer. A second
    // navigation would deliver the authorization code twice.
    expect(mockLocationReplace).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("says to start again when the OAuth request has expired", async () => {
    mockSignInEmail.mockResolvedValue({
      data: null,
      error: { status: 400, error: "invalid_signature" },
    });

    render(<SignInForm />);

    await submitValidSignInForm();

    await waitFor(() => {
      expect(toast.error).toHaveBeenLastCalledWith("errorDescription");
    });
    expect(mockLocationReplace).not.toHaveBeenCalled();
  });

  it("carries the OAuth request on the register link", () => {
    mockSearchParams = new URLSearchParams({
      client_id: "cmo",
      exp: "1772367377",
      sig: "abc+def/ghi=",
    });

    render(<SignInForm />);

    expect(screen.getByRole("link", { name: "Register.link" })).toHaveAttribute(
      "href",
      "/signup?client_id=cmo&exp=1772367377&sig=abc%2Bdef%2Fghi%3D",
    );
  });

  it("hands the typed email to sign-up instead of putting it in the register link", async () => {
    const user = userEvent.setup();
    mockSearchParams = new URLSearchParams({ returnUrl: "/agents" });
    render(<SignInForm returnUrl="/agents" />);

    await user.type(
      screen.getByPlaceholderText("Fields.Email.placeholder"),
      "ada@exmaple.com",
    );
    const register = screen.getByRole("link", { name: "Register.link" });
    // A query email is an invitation's fixed address.
    expect(register).toHaveAttribute("href", "/signup?returnUrl=%2Fagents");

    fireEvent.click(register);

    expect(takeAuthEmailHint()).toBe("ada@exmaple.com");
  });

  it("leaves no email behind when register opens in another tab", async () => {
    const user = userEvent.setup();
    render(<SignInForm />);
    await user.type(
      screen.getByPlaceholderText("Fields.Email.placeholder"),
      "ada@example.com",
    );

    // The other tab cannot read this tab's hint, so this tab would show it
    // on its next sign-in or sign-up instead.
    fireEvent.click(screen.getByRole("link", { name: "Register.link" }), {
      metaKey: true,
    });

    expect(takeAuthEmailHint()).toBeNull();
  });

  it("keeps an invitation's address and id on the register link", () => {
    render(
      <SignInForm
        returnUrl="/accept-invitation/inv_1"
        prefilledEmail="invited@example.com"
        invitationId="inv_1"
      />,
    );

    const register = screen.getByRole("link", { name: "Register.link" });
    expect(register).toHaveAttribute(
      "href",
      "/signup?returnUrl=%2Faccept-invitation%2Finv_1&email=invited%40example.com&invitationId=inv_1",
    );

    fireEvent.click(register);

    expect(takeAuthEmailHint()).toBeNull();
  });

  it("hands a locked email without an invitation to sign-up as a starting value", () => {
    render(<SignInForm prefilledEmail="invited@example.com" />);

    const register = screen.getByRole("link", { name: "Register.link" });
    expect(register).toHaveAttribute("href", "/signup");

    fireEvent.click(register);

    expect(takeAuthEmailHint()).toBe("invited@example.com");
  });

  it("does not count a login when no session appears", async () => {
    mockSignInEmail.mockResolvedValue({
      data: {},
      error: null,
    });
    mockWaitForAuthSession.mockResolvedValue(null);

    render(<SignInForm />);

    await submitValidSignInForm();

    await waitFor(() => {
      expect(mockLocationReplace).toHaveBeenCalledWith("/");
    });
    expect(fireGTMEvent.signIn).not.toHaveBeenCalled();
  });

  it("defaults rememberMe so Better Auth issues a persistent session cookie", async () => {
    // SOK-752: rememberMe:false → session cookie (no Max-Age). iOS kills the
    // PWA process after a few minutes in background and drops that cookie;
    // Android/desktop keep the browser process alive longer.
    mockSignInEmail.mockResolvedValue({
      data: {},
      error: null,
    });

    render(<SignInForm />);

    await submitValidSignInForm();

    await waitFor(() => {
      expect(mockSignInEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          rememberMe: true,
        }),
      );
    });
  });

  it("keeps a left-edge submit spinner after credential login succeeds", async () => {
    mockSignInEmail.mockResolvedValue({
      data: {},
      error: null,
    });

    render(<SignInForm />);

    await submitValidSignInForm();

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

  it("releases the submit spinner after credential login fails", async () => {
    mockSignInEmail.mockResolvedValue({
      data: null,
      error: { message: "Invalid credentials" },
    });

    render(<SignInForm />);

    await submitValidSignInForm();

    const submitButton = screen.getByRole("button", { name: "submit" });

    await waitFor(() => {
      expect(submitButton).toBeEnabled();
    });

    expect(submitButton.querySelector("svg.animate-spin")).toBeNull();
  });
});

vi.mock("@/components/auth-captcha", () => import("@/test/auth-captcha-mock"));
