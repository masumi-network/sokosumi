import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { type ReactNode, StrictMode } from "react";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  rememberAuthEmailHint,
  takeAuthEmailHint,
  takeSignUpHandover,
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
const pushMock = vi.fn();

let mockSearchParams = new URLSearchParams();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
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

// Step 2 has its own tests; the real one runs in the code step's flow tests.
vi.mock("./form", () => ({
  __esModule: true,
  default: (props: { onChangeEmail?: () => void; children?: ReactNode }) => {
    signInFormMock(props);
    return (
      <div data-testid="sign-in-form">
        {props.onChangeEmail ? (
          <button type="button" onClick={props.onChangeEmail}>
            changeEmail
          </button>
        ) : null}
        {props.children}
      </div>
    );
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
    emailStatusMock.mockResolvedValue({
      data: { exists: true, hasPassword: false },
      error: null,
    });
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

  describe("step 1", () => {
    const CMO = { name: "CMO", uri: "https://cmo.xyz", logoUri: undefined };

    it("asks for the email in one field named by its placeholder, with Register in the links row", () => {
      render(<SignInFlow lastUsedMethod={null} />);

      expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
        "title",
      );
      expect(screen.getByText("description")).toBeInTheDocument();
      const field = screen.getByTestId("auth-field-email");
      expect(field).toBe(emailField());
      expect(field).toHaveAttribute("placeholder", "label");
      // No visible label: the placeholder names the field.
      expect(screen.queryByText("label")).not.toBeInTheDocument();
      expect(
        screen.getByText("Register.message", { exact: false }),
      ).toContainElement(screen.getByRole("link", { name: "Register.link" }));
    });

    it("leads with the way back to an outside product and names it", () => {
      render(<SignInFlow lastUsedMethod={null} client={CMO} />);

      const back = screen.getByRole("link", { name: "backTo:CMO" });
      expect(back).toHaveAttribute("href", "https://cmo.xyz");
      expect(
        back.compareDocumentPosition(screen.getByRole("heading")) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      expect(screen.getByText("descriptionFor:CMO")).toBeInTheDocument();
    });

    it("says an invitation brought the person here and shows its address read-only", async () => {
      const user = userEvent.setup();
      render(
        <SignInFlow
          lastUsedMethod={null}
          client={CMO}
          prefilledEmail="invited@example.com"
          invitationId="inv_1"
        />,
      );

      expect(screen.getByText("invitation")).toBeInTheDocument();
      expect(screen.queryByText("descriptionFor:CMO")).not.toBeInTheDocument();
      await user.type(emailField(), "x");
      expect(emailField()).toHaveValue("invited@example.com");
      expect(emailField()).toHaveAttribute("readonly");
    });

    it("keeps the field's line neutral under the unknown-address notice, and clears the notice on an edit", async () => {
      const user = userEvent.setup();
      emailStatusMock.mockResolvedValue({
        data: { exists: false },
        error: null,
      });
      render(<SignInFlow lastUsedMethod={null} />);

      await continueWith(user, "new@example.com");
      await waitFor(() =>
        expect(detour()).toHaveAttribute("data-state", "open"),
      );
      // The address is not wrong; it has no account.
      expect(emailField()).not.toHaveAttribute("aria-invalid", "true");

      await user.type(emailField(), "x");

      expect(detour()).toHaveAttribute("data-state", "closed");
      expect(screen.getByRole("status")).toBeEmptyDOMElement();
      expect(
        screen.getByRole("button", { name: "continueWithEmail" }),
      ).not.toHaveAttribute("inert");
    });

    it("explains an invalid address under the field", async () => {
      const user = userEvent.setup();
      render(<SignInFlow lastUsedMethod={null} />);

      await continueWith(user, "not-an-address");

      await waitFor(() =>
        expect(emailField()).toHaveAttribute("aria-invalid", "true"),
      );
      expect(emailStatusMock).not.toHaveBeenCalled();
      expect(emailField()).toHaveAccessibleDescription(/.+/);
    });
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

  // A code sign-in to an account whose address is unproven removes its
  // password, so a new browser asks for the password instead.
  it("opens on the password without emailing a code when the account has one", async () => {
    const user = userEvent.setup();
    emailStatusMock.mockResolvedValue({
      data: { exists: true, hasPassword: true },
      error: null,
    });
    render(<SignInFlow lastUsedMethod={null} />);

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

  it("asks again after the address changes to one without a password", async () => {
    const user = userEvent.setup();
    emailStatusMock.mockResolvedValueOnce({
      data: { exists: true, hasPassword: true },
      error: null,
    });
    render(<SignInFlow lastUsedMethod={null} />);
    await continueWith(user, "ada@example.com");
    await waitFor(() => expect(signInFormMock).toHaveBeenCalled());

    await user.click(screen.getByRole("button", { name: "changeEmail" }));
    await user.clear(emailField());
    await continueWith(user, "grace@example.com");

    await waitFor(() =>
      expect(signInFormMock).toHaveBeenLastCalledWith(
        expect.objectContaining({
          email: "grace@example.com",
          initialMethod: "code",
        }),
      ),
    );
    expect(sendEmailCodeMock).toHaveBeenCalledOnce();
  });

  // The cookie belongs to the browser, not the account: on a shared browser it
  // can name another person's code sign-in.
  it("opens on the password for an account with one, even when the code was used last", async () => {
    const user = userEvent.setup();
    emailStatusMock.mockResolvedValue({
      data: { exists: true, hasPassword: true },
      error: null,
    });
    render(<SignInFlow lastUsedMethod="email-otp" />);

    await continueWith(user, "ada@example.com");

    await waitFor(() =>
      expect(signInFormMock).toHaveBeenLastCalledWith(
        expect.objectContaining({ initialMethod: "password" }),
      ),
    );
    expect(sendEmailCodeMock).not.toHaveBeenCalled();
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

  async function showCreateAccount(user: ReturnType<typeof userEvent.setup>) {
    emailStatusMock.mockResolvedValue({ data: { exists: false }, error: null });
    render(<SignInFlow lastUsedMethod={null} />);
    await continueWith(user, "new@example.com");
    const createAccount = await screen.findByRole("link", {
      name: "NoAccount.createAccount",
    });
    await waitFor(() => expect(createAccount).toHaveFocus());
    // Past the guard against the second click of a double-click.
    await new Promise((resolve) => setTimeout(resolve, 450));
    sendEmailCodeMock.mockClear();
    return createAccount;
  }

  it("emails the sign-up code from Create account, then opens sign-up on step 2", async () => {
    const user = userEvent.setup();
    const createAccount = await showCreateAccount(user);
    let finishSend!: (result: { data: unknown; error: null }) => void;
    sendEmailCodeMock.mockReturnValueOnce(
      new Promise((resolve) => {
        finishSend = resolve;
      }),
    );

    await user.click(createAccount);

    await waitFor(() =>
      expect(sendEmailCodeMock).toHaveBeenCalledWith({
        fetchOptions: captchaFetchOptions,
        email: "new@example.com",
        type: "sign-in",
      }),
    );
    expect(createAccount).toHaveAttribute("aria-busy", "true");
    expect(pushMock).not.toHaveBeenCalled();
    expect(emailField()).toBeEnabled();
    expect(lastSocialProps().disabled).toBe(true);

    await act(async () => {
      finishSend({ data: { success: true }, error: null });
    });

    expect(pushMock).toHaveBeenCalledWith("/signup");
    // Preparing the code is abortable; the dispatched navigation is not.
    expect(emailField()).toBeDisabled();
    expect(lastSocialProps().disabled).toBe(true);
    await user.type(emailField(), ".uk");
    expect(emailField()).toHaveValue("new@example.com");
    expect(lastSocialProps().disabled).toBe(true);
    expect(takeSignUpHandover()).toEqual({
      email: "new@example.com",
      codeSentAt: expect.any(Number),
    });
  });

  it("still opens sign-up on step 2 when the code could not be sent", async () => {
    const user = userEvent.setup();
    const createAccount = await showCreateAccount(user);
    sendEmailCodeMock.mockResolvedValueOnce({
      data: null,
      error: { message: "Too many requests", status: 429 },
    });

    await user.click(createAccount);

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/signup"));
    expect(takeSignUpHandover()).toEqual({
      email: "new@example.com",
      codeSentAt: null,
    });
  });

  it("sends nothing for a Create account click that opens another tab", async () => {
    const user = userEvent.setup();
    const createAccount = await showCreateAccount(user);

    fireEvent.click(createAccount, { metaKey: true });

    expect(sendEmailCodeMock).not.toHaveBeenCalled();
    expect(pushMock).not.toHaveBeenCalled();
    expect(takeAuthEmailHint()).toBeNull();
  });

  it("stays when the address is edited while the code is on its way", async () => {
    const user = userEvent.setup();
    const createAccount = await showCreateAccount(user);
    let finishSend!: (result: { data: unknown; error: null }) => void;
    sendEmailCodeMock.mockReturnValueOnce(
      new Promise((resolve) => {
        finishSend = resolve;
      }),
    );
    await user.click(createAccount);
    await waitFor(() => expect(sendEmailCodeMock).toHaveBeenCalled());

    fireEvent.change(emailField(), { target: { value: "bob@example.com" } });
    await act(async () => {
      finishSend({ data: { success: true }, error: null });
    });

    expect(pushMock).not.toHaveBeenCalled();
    expect(takeSignUpHandover()).toBeNull();
  });

  it("keeps a newer detour locked when an older cancelled send finishes", async () => {
    const user = userEvent.setup();
    const createAccount = await showCreateAccount(user);
    let finishFirst!: (result: { data: unknown; error: null }) => void;
    let finishSecond!: (result: { data: unknown; error: null }) => void;
    sendEmailCodeMock
      .mockReturnValueOnce(new Promise((resolve) => (finishFirst = resolve)))
      .mockReturnValueOnce(new Promise((resolve) => (finishSecond = resolve)));

    await user.click(createAccount);
    expect(lastSocialProps().disabled).toBe(true);
    await user.clear(emailField());
    await continueWith(user, "bob@example.com");
    await waitFor(() => expect(detour()).toHaveAttribute("data-state", "open"));
    await new Promise((resolve) => setTimeout(resolve, 450));
    await user.click(createAccount);
    expect(sendEmailCodeMock).toHaveBeenCalledTimes(2);
    expect(lastSocialProps().disabled).toBe(true);

    await act(async () => {
      finishFirst({ data: { success: true }, error: null });
    });
    expect(pushMock).not.toHaveBeenCalled();
    expect(lastSocialProps().disabled).toBe(true);
    expect(createAccount).toHaveAttribute("aria-busy", "true");

    await act(async () => {
      finishSecond({ data: { success: true }, error: null });
    });
    expect(pushMock).toHaveBeenCalledWith("/signup");
    expect(lastSocialProps().disabled).toBe(true);
    expect(emailField()).toBeDisabled();
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
    expect(emailField()).toHaveAttribute("readonly");
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
    expect(emailField()).not.toHaveAttribute("readonly");
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

    it("keeps an invitation, not its address, on the links to sign-up", async () => {
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
        "/signup?returnUrl=%2Faccept-invitation%2Finv_1&invitationId=inv_1";

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

  function lastSocialProps() {
    return socialButtonsMock.mock.lastCall?.[0] as {
      disabled: boolean;
      onPendingChange: (pending: boolean) => void;
    };
  }

  it("holds the providers while Continue checks the address", async () => {
    const user = userEvent.setup();
    let answer: (value: unknown) => void = () => {};
    emailStatusMock.mockReturnValue(
      new Promise((resolve) => (answer = resolve)),
    );
    render(<SignInFlow lastUsedMethod={null} />);
    expect(lastSocialProps().disabled).toBe(false);

    await continueWith(user, "ada@example.com");
    expect(lastSocialProps().disabled).toBe(true);

    await act(async () =>
      answer({ data: null, error: { message: "Core is down" } }),
    );
    expect(lastSocialProps().disabled).toBe(false);
  });

  it("frees the providers again when the person changes the address", async () => {
    const user = userEvent.setup();
    render(<SignInFlow lastUsedMethod={null} />);

    await continueWith(user, "ada@example.com");
    await waitFor(() => expect(signInFormMock).toHaveBeenCalled());
    socialButtonsMock.mockClear();
    await user.click(screen.getByRole("button", { name: "changeEmail" }));

    expect(socialButtonsMock).toHaveBeenCalled();
    for (const [props] of socialButtonsMock.mock.calls) {
      expect((props as { disabled: boolean }).disabled).toBe(false);
    }
  });

  it("holds the email while a provider sign-in starts", async () => {
    const user = userEvent.setup();
    render(<SignInFlow lastUsedMethod={null} />);
    await user.type(emailField(), "ada@example.com");
    const continueButton = screen.getByRole("button", {
      name: "continueWithEmail",
    });

    act(() => lastSocialProps().onPendingChange(true));

    expect(continueButton).toBeDisabled();
    expect(emailField()).toBeDisabled();
    // Enter in the field would submit; nothing may reach Core or send a code.
    fireEvent.submit(emailField().closest("form") as HTMLFormElement);
    await act(async () => {});
    expect(emailStatusMock).not.toHaveBeenCalled();
    expect(sendEmailCodeMock).not.toHaveBeenCalled();

    act(() => lastSocialProps().onPendingChange(false));
    expect(continueButton).toBeEnabled();
    expect(emailField()).toBeEnabled();
  });
});
