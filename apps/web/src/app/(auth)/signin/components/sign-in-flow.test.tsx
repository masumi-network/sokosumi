import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode } from "react";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  rememberAuthEmailHint,
  takeAuthEmailHint,
  takeAuthEmailHintEntry,
} from "@/lib/auth/auth-email-hint";
import { fireGTMEvent } from "@/lib/gtm-events";
import {
  captchaFetchOptions,
  requestCaptchaMock,
} from "@/test/auth-captcha-mock";

import SignInFlow from "./sign-in-flow";

const socialButtonsMock = vi.fn();
const signInFormMock = vi.fn();
const emailStatusMock = vi.fn();
const sendEmailCodeMock = vi.fn();

let mockSearchParams = new URLSearchParams();

vi.mock("next/navigation", () => ({
  useSearchParams: () => mockSearchParams as unknown as URLSearchParams,
}));

vi.mock("next-intl", () => ({
  useTranslations: () => {
    const t = (key: string, values?: Record<string, string>) =>
      values ? `${key}:${Object.values(values).join(",")}` : key;
    t.has = () => true;
    return t;
  },
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn() },
}));

vi.mock("@/lib/auth/auth.client", () => ({
  authClient: {
    $fetch: (...args: unknown[]) => emailStatusMock(...args),
    emailOtp: {
      sendVerificationOtp: (...args: unknown[]) => sendEmailCodeMock(...args),
    },
  },
}));

vi.mock("@vercel/analytics", () => ({ track: vi.fn() }));

vi.mock("@/components/auth-captcha", () => import("@/test/auth-captcha-mock"));

vi.mock("@/lib/gtm-events", () => ({
  fireGTMEvent: {
    viewLoginArea: vi.fn(),
    loginAreaFormStart: vi.fn(),
  },
}));

vi.mock("@/auth/components/social-buttons", () => ({
  __esModule: true,
  default: (props: unknown) => {
    socialButtonsMock(props);
    return <div data-testid="social-buttons" />;
  },
}));

vi.mock("./form", () => ({
  __esModule: true,
  default: (props: { onPendingChange: (pending: boolean) => void }) => {
    signInFormMock(props);
    return <div data-testid="sign-in-form" />;
  },
}));

function emailField() {
  return screen.getByLabelText("label");
}

async function continueWith(
  user: ReturnType<typeof userEvent.setup>,
  email: string,
) {
  await user.type(emailField(), email);
  await user.click(screen.getByRole("button", { name: "continueWithEmail" }));
}

function detour() {
  return screen.getByTestId("email-step-detour");
}

describe("SignInFlow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.sessionStorage.clear();
    mockSearchParams = new URLSearchParams();
    emailStatusMock.mockResolvedValue({ data: { exists: true }, error: null });
    sendEmailCodeMock.mockResolvedValue({
      data: { success: true },
      error: null,
    });
  });

  it("opens on the email beside the providers and the passkey", () => {
    render(<SignInFlow lastUsedMethod={null} />);

    expect(emailField()).toHaveAttribute("autocomplete", "username webauthn");
    expect(screen.getByTestId("social-buttons")).toBeInTheDocument();
    expect(socialButtonsMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ showPasskey: true, lastUsedMethod: null }),
    );
    expect(screen.queryByTestId("sign-in-form")).not.toBeInTheDocument();
  });

  it("checks the address and emails a code on Continue when no method is remembered", async () => {
    const user = userEvent.setup();
    render(<SignInFlow lastUsedMethod={null} />);

    await continueWith(user, "ada@example.com");

    await waitFor(() => expect(signInFormMock).toHaveBeenCalled());
    expect(emailStatusMock).toHaveBeenCalledWith("/sign-up/email-status", {
      method: "POST",
      body: { email: "ada@example.com" },
      headers: captchaFetchOptions.headers,
    });
    expect(sendEmailCodeMock).toHaveBeenCalledWith({
      fetchOptions: captchaFetchOptions,
      email: "ada@example.com",
      type: "sign-in",
    });
    expect(signInFormMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        email: "ada@example.com",
        initialMethod: "code",
        emailCode: expect.objectContaining({ sentTo: "ada@example.com" }),
      }),
    );
    expect(screen.getByTestId("confirmed-email")).toHaveTextContent(
      "ada@example.com",
    );
    expect(screen.queryByTestId("social-buttons")).not.toBeInTheDocument();
  });

  it("opens on the password without emailing a code when the password was used last", async () => {
    const user = userEvent.setup();
    render(<SignInFlow lastUsedMethod="email" />);

    expect(screen.getByText("lastUsed")).toBeInTheDocument();
    await continueWith(user, "ada@example.com");

    await waitFor(() => expect(signInFormMock).toHaveBeenCalled());
    expect(sendEmailCodeMock).not.toHaveBeenCalled();
    expect(signInFormMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        initialMethod: "password",
        emailCode: expect.objectContaining({ sentTo: null }),
      }),
    );
  });

  it("emails a code when the code was used last, and marks Continue", async () => {
    const user = userEvent.setup();
    render(<SignInFlow lastUsedMethod="email-otp" />);

    expect(screen.getByText("lastUsed")).toBeInTheDocument();
    expect(socialButtonsMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ lastUsedMethod: null }),
    );
    await continueWith(user, "ada@example.com");

    await waitFor(() =>
      expect(signInFormMock).toHaveBeenLastCalledWith(
        expect.objectContaining({ initialMethod: "code" }),
      ),
    );
    expect(sendEmailCodeMock).toHaveBeenCalledOnce();
  });

  it("marks the provider used last, not Continue", async () => {
    const user = userEvent.setup();
    render(<SignInFlow lastUsedMethod="google" />);

    expect(socialButtonsMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ lastUsedMethod: "google" }),
    );
    expect(screen.queryByText("lastUsed")).not.toBeInTheDocument();
    await continueWith(user, "ada@example.com");

    await waitFor(() =>
      expect(signInFormMock).toHaveBeenLastCalledWith(
        expect.objectContaining({ initialMethod: "code" }),
      ),
    );
  });

  it("opens step 2 without a code when the code could not be sent", async () => {
    const user = userEvent.setup();
    sendEmailCodeMock.mockResolvedValue({
      data: null,
      error: { message: "Too many requests" },
    });
    render(<SignInFlow lastUsedMethod={null} />);

    await continueWith(user, "ada@example.com");

    await waitFor(() => expect(signInFormMock).toHaveBeenCalled());
    expect(toast.error).toHaveBeenCalled();
    expect(signInFormMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        emailCode: expect.objectContaining({ sentTo: null }),
      }),
    );
  });

  it("offers sign-up instead of a code for an address without an account", async () => {
    const user = userEvent.setup();
    emailStatusMock.mockResolvedValue({ data: { exists: false }, error: null });
    render(<SignInFlow lastUsedMethod={null} />);

    await continueWith(user, "new@example.com");

    await waitFor(() => expect(detour()).toHaveAttribute("data-state", "open"));
    expect(screen.getByRole("status")).toHaveTextContent(
      "NoAccount.title. NoAccount.description",
    );
    expect(sendEmailCodeMock).not.toHaveBeenCalled();
    expect(signInFormMock).not.toHaveBeenCalled();
    expect(
      screen.getByRole("link", { name: "NoAccount.createAccount" }),
    ).toHaveAttribute("href", "/signup");
  });

  it("hands the typed email to sign-up when the person creates an account", async () => {
    const user = userEvent.setup();
    emailStatusMock.mockResolvedValue({ data: { exists: false }, error: null });
    render(<SignInFlow lastUsedMethod={null} />);
    await continueWith(user, "new@example.com");
    const createAccount = await screen.findByRole("link", {
      name: "NoAccount.createAccount",
    });
    await waitFor(() => expect(createAccount).toHaveFocus());

    // Past the guard against the second click of a double-click.
    await new Promise((resolve) => setTimeout(resolve, 450));
    await user.click(createAccount);

    // Sign-up rechecks this address, then continues without another click.
    expect(takeAuthEmailHintEntry()).toEqual({
      email: "new@example.com",
      noAccount: true,
    });
  });

  it("carries the OAuth request to sign-up", async () => {
    const user = userEvent.setup();
    mockSearchParams = new URLSearchParams({
      client_id: "cmo",
      exp: "1772367377",
      sig: "signed-value",
    });
    emailStatusMock.mockResolvedValue({ data: { exists: false }, error: null });
    render(<SignInFlow lastUsedMethod={null} />);

    expect(screen.getByRole("link", { name: "Register.link" })).toHaveAttribute(
      "href",
      "/signup?client_id=cmo&exp=1772367377&sig=signed-value",
    );
    await continueWith(user, "new@example.com");

    expect(
      await screen.findByRole("link", { name: "NoAccount.createAccount" }),
    ).toHaveAttribute(
      "href",
      "/signup?client_id=cmo&exp=1772367377&sig=signed-value",
    );
  });

  it("says to start again when the OAuth request expired before the first step", async () => {
    const user = userEvent.setup();
    emailStatusMock.mockResolvedValue({
      data: null,
      error: { status: 400, error: "invalid_signature" },
    });
    render(<SignInFlow lastUsedMethod={null} />);

    await continueWith(user, "ada@example.com");

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("errorDescription"),
    );
    expect(signInFormMock).not.toHaveBeenCalled();
  });

  it("asks Core nothing when the security check is cancelled", async () => {
    const user = userEvent.setup();
    requestCaptchaMock.mockResolvedValue(null);
    render(<SignInFlow lastUsedMethod={null} />);

    await continueWith(user, "ada@example.com");

    expect(emailStatusMock).not.toHaveBeenCalled();
    expect(signInFormMock).not.toHaveBeenCalled();
  });

  it("returns to the email step with the address kept and focused", async () => {
    const user = userEvent.setup();
    render(<SignInFlow lastUsedMethod={null} />);
    await continueWith(user, "ada@example.com");
    await waitFor(() => expect(signInFormMock).toHaveBeenCalled());

    await user.click(screen.getByRole("button", { name: "changeEmail" }));

    expect(emailField()).toHaveValue("ada@example.com");
    await waitFor(() => expect(emailField()).toHaveFocus());
    expect(screen.getByTestId("social-buttons")).toBeInTheDocument();
  });

  it("locks an invitation's email on both steps", async () => {
    const user = userEvent.setup();
    render(
      <SignInFlow lastUsedMethod={null} prefilledEmail="invited@example.com" />,
    );

    expect(emailField()).toHaveValue("invited@example.com");
    expect(emailField()).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "continueWithEmail" }));

    await waitFor(() => expect(signInFormMock).toHaveBeenCalled());
    expect(
      screen.queryByRole("button", { name: "changeEmail" }),
    ).not.toBeInTheDocument();
  });

  it("starts from the email sign-up handed over, editable", async () => {
    rememberAuthEmailHint("ada@example.com");

    render(<SignInFlow lastUsedMethod={null} />);

    await waitFor(() => expect(emailField()).toHaveValue("ada@example.com"));
    expect(emailField()).toBeEnabled();
    expect(takeAuthEmailHint()).toBeNull();
  });

  it("keeps a locked invitation email over a handed-over one", () => {
    rememberAuthEmailHint("ada@example.com");

    render(
      <SignInFlow lastUsedMethod={null} prefilledEmail="invited@example.com" />,
    );

    expect(emailField()).toHaveValue("invited@example.com");
  });

  it("retains the one-time hint in Strict Mode", async () => {
    rememberAuthEmailHint("ada@example.com");

    render(
      <StrictMode>
        <SignInFlow lastUsedMethod={null} />
      </StrictMode>,
    );

    await waitFor(() => expect(emailField()).toHaveValue("ada@example.com"));
    expect(takeAuthEmailHint()).toBeNull();
  });

  describe("Register link", () => {
    function register() {
      return screen.getByRole("link", { name: "Register.link" });
    }

    it("hands the typed email to sign-up instead of putting it in the link", async () => {
      const user = userEvent.setup();
      mockSearchParams = new URLSearchParams({ returnUrl: "/agents" });
      render(<SignInFlow lastUsedMethod={null} returnUrl="/agents" />);

      await user.type(emailField(), "ada@exmaple.com");
      // A query email is an invitation's fixed address.
      expect(register()).toHaveAttribute("href", "/signup?returnUrl=%2Fagents");

      fireEvent.click(register());

      expect(takeAuthEmailHint()).toBe("ada@exmaple.com");
    });

    it("leaves no email behind when sign-up opens in another tab", async () => {
      const user = userEvent.setup();
      render(<SignInFlow lastUsedMethod={null} />);
      await user.type(emailField(), "ada@example.com");

      // The other tab cannot read this tab's hint, so this tab would show it
      // on its next sign-in or sign-up instead.
      fireEvent.click(register(), { metaKey: true });

      expect(takeAuthEmailHint()).toBeNull();
    });

    it("clears an old hint on a middle click", () => {
      render(<SignInFlow lastUsedMethod={null} />);
      rememberAuthEmailHint("stale@example.com");

      fireEvent(
        register(),
        new MouseEvent("auxclick", { bubbles: true, button: 1 }),
      );

      expect(takeAuthEmailHint()).toBeNull();
    });

    it("keeps an invitation's address and id on the links to sign-up", async () => {
      const user = userEvent.setup();
      emailStatusMock.mockResolvedValue({
        data: { exists: false },
        error: null,
      });
      render(
        <SignInFlow
          lastUsedMethod={null}
          returnUrl="/accept-invitation/inv_1"
          prefilledEmail="invited@example.com"
          invitationId="inv_1"
        />,
      );
      const href =
        "/signup?returnUrl=%2Faccept-invitation%2Finv_1&email=invited%40example.com&invitationId=inv_1";

      expect(register()).toHaveAttribute("href", href);
      fireEvent.click(register());
      expect(takeAuthEmailHint()).toBeNull();

      await user.click(
        screen.getByRole("button", { name: "continueWithEmail" }),
      );
      expect(
        await screen.findByRole("link", { name: "NoAccount.createAccount" }),
      ).toHaveAttribute("href", href);
    });

    it("hands a locked email without an invitation to sign-up as a starting value", () => {
      render(
        <SignInFlow
          lastUsedMethod={null}
          prefilledEmail="invited@example.com"
        />,
      );

      expect(register()).toHaveAttribute("href", "/signup");
      fireEvent.click(register());

      expect(takeAuthEmailHint()).toBe("invited@example.com");
    });
  });

  it("counts the login view once and the form start once", async () => {
    const user = userEvent.setup();
    render(<SignInFlow lastUsedMethod={null} />);

    await continueWith(user, "ada@example.com");
    await waitFor(() => expect(signInFormMock).toHaveBeenCalled());

    expect(fireGTMEvent.viewLoginArea).toHaveBeenCalledOnce();
    expect(fireGTMEvent.loginAreaFormStart).toHaveBeenCalledOnce();
  });

  it("shows the notice on the email step and the page's children on both", async () => {
    const user = userEvent.setup();
    render(
      <SignInFlow lastUsedMethod={null} notice={<p>why-you-are-back</p>}>
        <p>terms</p>
      </SignInFlow>,
    );

    expect(screen.getByText("why-you-are-back")).toBeInTheDocument();
    expect(screen.getByText("terms")).toBeInTheDocument();
    await continueWith(user, "ada@example.com");
    await waitFor(() => expect(signInFormMock).toHaveBeenCalled());

    expect(screen.queryByText("why-you-are-back")).not.toBeInTheDocument();
    expect(screen.getByText("terms")).toBeInTheDocument();
  });
});
