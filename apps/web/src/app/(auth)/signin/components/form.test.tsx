import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { track } from "@vercel/analytics";
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

import { type EmailCode, useEmailCode } from "@/auth/components/use-email-code";
import { useMountEffect } from "@/hooks/use-mount-effect";
import { fireGTMEvent } from "@/lib/gtm-events";
import {
  captchaErrorMessageMock,
  captchaFetchOptions,
  requestCaptchaMock,
} from "@/test/auth-captcha-mock";

import SignInForm from "./form";

const EMAIL = "login-user@example.com";

const mockLocationReplace = vi.fn();
const mockSignInEmail = vi.fn();
const mockSendEmailCode = vi.fn();
const mockSignInEmailCode = vi.fn();
const mockGetSession = vi.fn();
const mockWaitForAuthSession = vi.fn().mockResolvedValue(undefined);

let mockSearchParams = new URLSearchParams();

vi.mock("next/navigation", () => ({
  useSearchParams: () => mockSearchParams as unknown as URLSearchParams,
}));

vi.mock("next-intl", () => ({
  useTranslations: () => {
    const t = (key: string, values?: Record<string, string | number>) =>
      values ? `${key}:${Object.values(values).join(",")}` : key;
    t.has = () => true;
    return t;
  },
}));

vi.mock("@vercel/analytics", () => ({ track: vi.fn() }));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/lib/actions/errors/error-codes/auth", () => ({
  AuthErrorCode: { TERMS_NOT_ACCEPTED: "TERMS_NOT_ACCEPTED" },
}));

vi.mock("@/lib/auth/auth.client", () => ({
  authClient: {
    getSession: (...args: unknown[]) => mockGetSession(...args),
    emailOtp: {
      sendVerificationOtp: (...args: unknown[]) => mockSendEmailCode(...args),
    },
    signIn: {
      emailOtp: (...args: unknown[]) => mockSignInEmailCode(...args),
    },
  },
  signIn: {
    email: (...args: unknown[]) => mockSignInEmail(...args),
  },
}));

vi.mock("@/lib/gtm-events", () => ({
  fireGTMEvent: { signIn: vi.fn() },
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

vi.mock("@/components/auth-captcha", () => import("@/test/auth-captcha-mock"));

function fakeEmailCode(overrides: Partial<EmailCode> = {}): EmailCode {
  return {
    captcha: null,
    isSending: false,
    sentTo: EMAIL,
    sentAt: Date.now(),
    sendCode: vi.fn().mockResolvedValue(Date.now()),
    adoptSentCode: vi.fn(),
    signInWithCode: vi.fn().mockResolvedValue(undefined),
    removedSignInMethods: null,
    ...overrides,
  };
}

function renderForm(
  props: Partial<Parameters<typeof SignInForm>[0]> = {},
): Parameters<typeof SignInForm>[0] {
  const all = {
    email: EMAIL,
    initialMethod: "password" as const,
    emailCode: fakeEmailCode({ sentTo: null }),
    onFormStart: vi.fn(),
    onPendingChange: vi.fn(),
    ...props,
  };
  render(<SignInForm {...all} />);
  return all;
}

/** Real code hook and finish path, with only external auth/session responses mocked. */
function SignInCodeStep() {
  const emailCode = useEmailCode({ eventType: "signIn", returnUrl: "/chat" });
  useMountEffect(() => {
    void emailCode.sendCode(EMAIL);
  });
  return (
    <SignInForm
      email={EMAIL}
      initialMethod="code"
      emailCode={emailCode}
      onFormStart={vi.fn()}
      onPendingChange={vi.fn()}
    />
  );
}

function passwordField() {
  return screen.getByLabelText("Fields.Password.label");
}

function codeField() {
  return screen.getByRole("textbox", { name: "codeLabel" });
}

async function submitPassword() {
  const user = userEvent.setup();
  await user.type(passwordField(), "Passw0rd!");
  await user.click(screen.getByRole("button", { name: "submit" }));
}

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
    vi.clearAllMocks();
    mockWaitForAuthSession.mockResolvedValue(undefined);
    mockSendEmailCode.mockResolvedValue({
      data: { success: true },
      error: null,
    });
    mockSignInEmailCode.mockResolvedValue({ data: {}, error: null });
    mockSearchParams = new URLSearchParams();
  });

  describe("with the code", () => {
    it("opens on the code when it was sent, with focus in its field", async () => {
      renderForm({ initialMethod: "code", emailCode: fakeEmailCode() });

      await waitFor(() => expect(codeField()).toHaveFocus());
      expect(
        screen.queryByLabelText("Fields.Password.label"),
      ).not.toBeInTheDocument();
    });

    it("signs in with the code and stays locked while the page leaves", async () => {
      const user = userEvent.setup();
      const emailCode = fakeEmailCode();
      const { onPendingChange } = renderForm({
        initialMethod: "code",
        emailCode,
      });

      await user.type(codeField(), "042917");
      await user.click(screen.getByRole("button", { name: "submit" }));

      await waitFor(() =>
        expect(emailCode.signInWithCode).toHaveBeenCalledWith(EMAIL, "042917"),
      );
      expect(onPendingChange).toHaveBeenCalledWith(true);
      expect(screen.getByRole("button", { name: "submit" })).toBeDisabled();
    });

    it("signs in as soon as the sixth digit is typed, without the button", async () => {
      const user = userEvent.setup();
      const emailCode = fakeEmailCode();
      const { onPendingChange } = renderForm({
        initialMethod: "code",
        emailCode,
      });

      await user.type(codeField(), "042917");

      await waitFor(() =>
        expect(emailCode.signInWithCode).toHaveBeenCalledExactlyOnceWith(
          EMAIL,
          "042917",
        ),
      );
      expect(track).toHaveBeenCalledWith("Sign In", { provider: "email-otp" });
      expect(onPendingChange).toHaveBeenCalledWith(true);
    });

    it("signs in with a pasted code that carries a dash", async () => {
      const user = userEvent.setup();
      const emailCode = fakeEmailCode();
      renderForm({ initialMethod: "code", emailCode });

      await user.click(codeField());
      await user.paste("042-917");

      await waitFor(() =>
        expect(emailCode.signInWithCode).toHaveBeenCalledExactlyOnceWith(
          EMAIL,
          "042917",
        ),
      );
    });

    it("shows the step as busy while the code is checked, and sends it once", async () => {
      const user = userEvent.setup();
      const emailCode = fakeEmailCode({
        signInWithCode: vi.fn(() => new Promise<undefined>(() => {})),
      });
      renderForm({ initialMethod: "code", emailCode });

      await user.type(codeField(), "042917");

      await waitFor(() =>
        expect(screen.getByRole("button", { name: "submit" })).toBeDisabled(),
      );
      expect(codeField()).toBeDisabled();
      expect(emailCode.signInWithCode).toHaveBeenCalledOnce();
    });

    it("empties a refused code's field, keeps the reason until typing, and sends the same code again", async () => {
      const user = userEvent.setup();
      const emailCode = fakeEmailCode({
        signInWithCode: vi
          .fn()
          .mockResolvedValue({ code: "INVALID_OTP", message: "Invalid OTP" }),
      });
      renderForm({ initialMethod: "code", emailCode });

      await user.type(codeField(), "000000");
      await waitFor(() =>
        expect(codeField()).toHaveAccessibleDescription(/invalid$/),
      );
      // The field takes six digits; the refused ones would block the next code.
      expect(codeField()).toHaveValue("");
      await waitFor(() => expect(codeField()).toHaveFocus());

      // Typing replaces the reason, without asking for the rest of the code.
      await user.type(codeField(), "0");
      expect(codeField()).not.toHaveAttribute("aria-invalid");

      await user.type(codeField(), "00000");
      await waitFor(() =>
        expect(emailCode.signInWithCode).toHaveBeenCalledTimes(2),
      );
      expect(emailCode.signInWithCode).toHaveBeenLastCalledWith(
        EMAIL,
        "000000",
      );
    });

    it("shares a synchronous lock between completion and manual submit", async () => {
      const emailCode = fakeEmailCode({
        signInWithCode: vi.fn(() => new Promise<undefined>(() => {})),
      });
      renderForm({ initialMethod: "code", emailCode });
      const code = codeField();
      const formElement = code.closest("form");
      if (!formElement) throw new Error("Missing sign-in form");

      act(() => {
        fireEvent.change(code, { target: { value: "042917" } });
        fireEvent.submit(formElement);
        fireEvent.submit(formElement);
      });

      await waitFor(() =>
        expect(emailCode.signInWithCode).toHaveBeenCalledOnce(),
      );
      expect(code).toBeDisabled();
      fireEvent.submit(formElement);
      await act(async () => {});
      expect(emailCode.signInWithCode).toHaveBeenCalledOnce();
      expect(code).toBeDisabled();
    });

    it("sends a refused code again when it is typed after a method switch", async () => {
      const user = userEvent.setup();
      const emailCode = fakeEmailCode({
        signInWithCode: vi.fn().mockResolvedValue({ code: "INVALID_OTP" }),
      });
      renderForm({ initialMethod: "code", emailCode });
      await user.type(codeField(), "000000");
      await waitFor(() =>
        expect(codeField()).toHaveAccessibleDescription(/invalid$/),
      );
      await user.click(
        screen.getByRole("button", { name: "usePasswordInstead" }),
      );
      await user.click(screen.getByRole("button", { name: "useCodeInstead" }));
      expect(codeField()).toHaveValue("");
      await user.type(codeField(), "000000");
      await waitFor(() =>
        expect(emailCode.signInWithCode).toHaveBeenCalledTimes(2),
      );
    });

    it.each(["042 917", "042-917", "042917"])(
      "finishes automatic sign-in through the real code hook for a pasted %s",
      async (entered) => {
        const user = userEvent.setup();
        mockWaitForAuthSession.mockResolvedValue({ id: "session-1" });
        render(<SignInCodeStep />);
        const code = await screen.findByRole("textbox", { name: "codeLabel" });
        await user.click(code);
        await user.paste(entered);
        await waitFor(() =>
          expect(mockLocationReplace).toHaveBeenCalledWith("/chat"),
        );
        expect(mockSendEmailCode).toHaveBeenCalledExactlyOnceWith({
          fetchOptions: captchaFetchOptions,
          email: EMAIL,
          type: "sign-in",
        });
        expect(mockSignInEmailCode).toHaveBeenCalledExactlyOnceWith({
          email: EMAIL,
          otp: "042917",
        });
        expect(track).toHaveBeenCalledWith("Sign In", {
          provider: "email-otp",
        });
        expect(fireGTMEvent.signIn).toHaveBeenCalledExactlyOnceWith(
          "email-otp",
        );
        expect(code).toBeDisabled();
        const formElement = code.closest("form");
        if (!formElement) throw new Error("Missing sign-in form");
        fireEvent.submit(formElement);
        await act(async () => {});
        expect(mockSignInEmailCode).toHaveBeenCalledOnce();
      },
    );

    // Better Auth deletes the password and provider links of an account
    // whose address was unproven when a code signs into it. Core says so.
    describe("when the code removed the old sign-in methods", () => {
      function signInRemovingMethods() {
        mockWaitForAuthSession.mockResolvedValue({ id: "session-1" });
        mockSendEmailCode.mockResolvedValue({
          data: { success: true },
          error: null,
        });
        mockSignInEmailCode.mockResolvedValue({
          data: {
            token: "token",
            user: { id: "user-1" },
            signInMethodsRemoved: true,
          },
          error: null,
        });
      }

      async function enterCode() {
        render(<SignInCodeStep />);
        const code = await screen.findByRole("textbox", { name: "codeLabel" });
        fireEvent.change(code, { target: { value: "042917" } });
        return screen.findByRole("alertdialog");
      }

      it("says so before leaving, and leaves once on Continue", async () => {
        signInRemovingMethods();

        const notice = await enterCode();

        expect(notice).toHaveTextContent("SignInMethodsRemoved.title");
        expect(notice).toHaveTextContent("SignInMethodsRemoved.description");
        expect(mockLocationReplace).not.toHaveBeenCalled();
        await userEvent.setup().click(
          screen.getByRole("button", {
            name: "SignInMethodsRemoved.continue",
          }),
        );
        await waitFor(() =>
          expect(mockLocationReplace).toHaveBeenCalledExactlyOnceWith("/chat"),
        );
        expect(fireGTMEvent.signIn).toHaveBeenCalledExactlyOnceWith(
          "email-otp",
        );
      });

      it("takes the person to set a new password", async () => {
        signInRemovingMethods();

        await enterCode();
        await userEvent.setup().click(
          screen.getByRole("button", {
            name: "SignInMethodsRemoved.setPassword",
          }),
        );

        await waitFor(() =>
          expect(mockLocationReplace).toHaveBeenCalledExactlyOnceWith(
            "/account",
          ),
        );
      });
    });

    it("leaves without a notice when the code removed nothing", async () => {
      mockWaitForAuthSession.mockResolvedValue({ id: "session-1" });
      mockSendEmailCode.mockResolvedValue({
        data: { success: true },
        error: null,
      });
      mockSignInEmailCode.mockResolvedValue({
        data: { token: "token", user: { id: "user-1" } },
        error: null,
      });
      render(<SignInCodeStep />);
      const code = await screen.findByRole("textbox", { name: "codeLabel" });

      fireEvent.change(code, { target: { value: "042917" } });

      await waitFor(() =>
        expect(mockLocationReplace).toHaveBeenCalledWith("/chat"),
      );
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    });

    it("asks for all six digits before sending anything", async () => {
      const user = userEvent.setup();
      const emailCode = fakeEmailCode();
      renderForm({ initialMethod: "code", emailCode });

      await user.type(codeField(), "0429");
      await user.click(screen.getByRole("button", { name: "submit" }));

      await waitFor(() =>
        expect(codeField()).toHaveAccessibleDescription(/incomplete$/),
      );
      expect(emailCode.signInWithCode).not.toHaveBeenCalled();
    });

    it("explains a refused code beside its field", async () => {
      const user = userEvent.setup();
      const emailCode = fakeEmailCode({
        signInWithCode: vi
          .fn()
          .mockResolvedValue({ code: "INVALID_OTP", message: "Invalid OTP" }),
      });
      const { onPendingChange } = renderForm({
        initialMethod: "code",
        emailCode,
      });

      await user.type(codeField(), "000000");

      await waitFor(() =>
        expect(codeField()).toHaveAccessibleDescription(/invalid$/),
      );
      await waitFor(() => expect(codeField()).toHaveFocus());
      expect(onPendingChange).not.toHaveBeenCalledWith(true);
    });

    it("switches to the password and back without a new code", async () => {
      const user = userEvent.setup();
      const emailCode = fakeEmailCode();
      renderForm({ initialMethod: "code", emailCode });

      await user.click(
        screen.getByRole("button", { name: "usePasswordInstead" }),
      );
      expect(passwordField()).toBeInTheDocument();
      expect(screen.getByText(/codeStillWorks/)).toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "useCodeInstead" }));
      expect(codeField()).toBeInTheDocument();
      expect(emailCode.sendCode).not.toHaveBeenCalled();
    });

    it("resends the code to the confirmed address", async () => {
      const user = userEvent.setup();
      const emailCode = fakeEmailCode({ sentAt: Date.now() - 60_000 });
      renderForm({ initialMethod: "code", emailCode });

      await user.click(screen.getByRole("button", { name: "resend" }));

      expect(emailCode.sendCode).toHaveBeenCalledWith(EMAIL);
    });
  });

  describe("with the password", () => {
    it("opens on the password when that was used last", async () => {
      renderForm();

      await waitFor(() => expect(passwordField()).toHaveFocus());
      expect(
        screen.queryByRole("textbox", { name: "codeLabel" }),
      ).not.toBeInTheDocument();
    });

    it("opens on the password when the code could not be sent", () => {
      renderForm({ initialMethod: "code" });

      expect(passwordField()).toBeInTheDocument();
    });

    it("emails a code on request and then asks for it", async () => {
      const user = userEvent.setup();
      const emailCode = fakeEmailCode({ sentTo: null });
      const { rerender } = render(
        <SignInForm
          email={EMAIL}
          initialMethod="password"
          emailCode={emailCode}
          onFormStart={vi.fn()}
          onPendingChange={vi.fn()}
        />,
      );

      await user.click(
        screen.getByRole("button", { name: "emailCodeInstead" }),
      );
      expect(emailCode.sendCode).toHaveBeenCalledWith(EMAIL);

      rerender(
        <SignInForm
          email={EMAIL}
          initialMethod="password"
          emailCode={{ ...emailCode, sentTo: EMAIL }}
          onFormStart={vi.fn()}
          onPendingChange={vi.fn()}
        />,
      );
      expect(codeField()).toBeInTheDocument();
    });

    it("pairs the password with the address for password managers", () => {
      renderForm();

      const username = document.querySelector('input[autocomplete="username"]');
      expect(username).toHaveValue(EMAIL);
      expect(passwordField()).toHaveAttribute(
        "autocomplete",
        "current-password",
      );
    });

    // The URL reaches server logs and analytics; the address goes through
    // session storage instead.
    it("hands the address to the password reset outside the URL", () => {
      renderForm();
      const link = screen.getByRole("link", { name: "forgotPassword" });

      expect(link).toHaveAttribute("href", "/forgot-password");
      window.sessionStorage.clear();
      fireEvent.click(link);
      expect(window.sessionStorage.getItem("auth-email-hint")).toBe(EMAIL);
    });

    it("keeps where the person was going on the password reset link", () => {
      mockSearchParams = new URLSearchParams("returnUrl=/chat");
      renderForm({ returnUrl: "/chat" });

      expect(
        screen.getByRole("link", { name: "forgotPassword" }),
      ).toHaveAttribute("href", "/forgot-password?returnUrl=%2Fchat");
    });

    // Sign-in after the reset locks the invited address again.
    it("keeps the invitation on the password reset link", () => {
      mockSearchParams = new URLSearchParams(
        "returnUrl=/accept-invitation/inv_1&invitationId=inv_1",
      );
      renderForm({ returnUrl: "/accept-invitation/inv_1" });

      expect(
        screen.getByRole("link", { name: "forgotPassword" }),
      ).toHaveAttribute(
        "href",
        "/forgot-password?returnUrl=%2Faccept-invitation%2Finv_1&invitationId=inv_1",
      );
    });

    it("keeps the signed OAuth request on the password reset link", () => {
      const oauthQuery = "client_id=cmo&exp=1900000000&sig=abc%2B%2F%3D";
      mockSearchParams = new URLSearchParams(oauthQuery);
      renderForm();

      expect(
        screen.getByRole("link", { name: "forgotPassword" }),
      ).toHaveAttribute("href", `/forgot-password?${oauthQuery}`);
    });

    it("focuses the password when it is missing", async () => {
      const user = userEvent.setup();
      renderForm();

      await user.click(screen.getByRole("button", { name: "submit" }));

      await waitFor(() => expect(passwordField()).toHaveFocus());
      expect(mockSignInEmail).not.toHaveBeenCalled();
    });

    // SOK-1259: every log-in is persistent, so there is nothing to choose.
    it("offers no Keep me logged in choice", () => {
      renderForm();

      expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    });

    it("signs in with the verified captcha and a persistent session", async () => {
      mockSignInEmail.mockResolvedValue({ data: {}, error: null });
      renderForm({ returnUrl: "/chat" });

      await submitPassword();

      await waitFor(() =>
        expect(mockLocationReplace).toHaveBeenCalledWith("/chat"),
      );
      // SOK-752: rememberMe:false → a session cookie iOS drops with the PWA.
      expect(mockSignInEmail).toHaveBeenCalledWith({
        fetchOptions: captchaFetchOptions,
        email: EMAIL,
        password: "Passw0rd!",
        rememberMe: true,
      });
      expect(fireGTMEvent.signIn).not.toHaveBeenCalled();
    });

    it("fires login in place once a session appears", async () => {
      mockSignInEmail.mockResolvedValue({ data: {}, error: null });
      mockWaitForAuthSession.mockResolvedValue({ id: "session-1" });
      const { onPendingChange } = renderForm({ returnUrl: "/chat" });

      await submitPassword();

      await waitFor(() =>
        expect(fireGTMEvent.signIn).toHaveBeenCalledWith("credential"),
      );
      expect(onPendingChange).toHaveBeenCalledWith(true);
      expect(screen.getByRole("button", { name: "submit" })).toBeDisabled();
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
      renderForm();

      await submitPassword();

      await waitFor(() =>
        expect(fireGTMEvent.signIn).toHaveBeenCalledWith("credential"),
      );
      // Better Auth's client follows the provider's answer. A second
      // navigation would deliver the authorization code twice.
      expect(mockLocationReplace).not.toHaveBeenCalled();
    });

    it("says to start again when the OAuth request has expired", async () => {
      mockSignInEmail.mockResolvedValue({
        data: null,
        error: { status: 400, error: "invalid_signature" },
      });
      renderForm();

      await submitPassword();

      await waitFor(() =>
        expect(toast.error).toHaveBeenLastCalledWith("errorDescription"),
      );
      expect(mockLocationReplace).not.toHaveBeenCalled();
    });

    it("says why when the updated terms are not accepted", async () => {
      mockSignInEmail.mockResolvedValue({
        data: null,
        error: { code: "TERMS_NOT_ACCEPTED", message: "Terms" },
      });
      renderForm();

      await submitPassword();

      await waitFor(() =>
        expect(toast.error).toHaveBeenLastCalledWith("Errors.termsNotAccepted"),
      );
    });

    it("shows translated captcha errors from Core and releases the form", async () => {
      const error = {
        code: "VERIFICATION_FAILED",
        message: "Captcha verification failed",
      };
      mockSignInEmail.mockResolvedValue({ data: null, error });
      captchaErrorMessageMock.mockReturnValue("Translated captcha error");
      const { onPendingChange } = renderForm();

      await submitPassword();

      await waitFor(() =>
        expect(toast.error).toHaveBeenLastCalledWith(
          "Translated captcha error",
        ),
      );
      expect(captchaErrorMessageMock).toHaveBeenCalledWith(
        error,
        error.message,
      );
      expect(onPendingChange).toHaveBeenLastCalledWith(false);
      expect(screen.getByRole("button", { name: "submit" })).toBeEnabled();
    });

    it("releases submit without signing in when the captcha is cancelled", async () => {
      requestCaptchaMock.mockResolvedValueOnce(null);
      renderForm();

      await submitPassword();

      await waitFor(() =>
        expect(screen.getByRole("button", { name: "submit" })).toBeEnabled(),
      );
      expect(mockSignInEmail).not.toHaveBeenCalled();
    });
  });
});
