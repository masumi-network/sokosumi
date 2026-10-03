import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode } from "react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  rememberAuthEmailHint,
  takeAuthEmailHint,
  takeSignInHandover,
} from "@/lib/auth/auth-email-hint";
import { fireGTMEvent } from "@/lib/gtm-events";
import {
  captchaFetchOptions,
  requestCaptchaMock,
} from "@/test/auth-captcha-mock";

import SignUpFlow from "./sign-up-flow";

const socialButtonsMock = vi.fn();
const signUpFormMock = vi.fn();
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

vi.mock("@/lib/actions/auth/action", () => ({ handleUtmConversion: vi.fn() }));

vi.mock("@/components/auth-captcha", () => import("@/test/auth-captcha-mock"));

vi.mock("@/lib/gtm-events", () => ({
  fireGTMEvent: {
    viewRegisterArea: vi.fn(),
    registerFormStart: vi.fn(),
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
  default: (props: { onFormStart: () => void }) => {
    signUpFormMock(props);
    return (
      <button type="button" onClick={props.onFormStart}>
        type in details
      </button>
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

describe("SignUpFlow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSearchParams = new URLSearchParams();
    window.sessionStorage.clear();
    emailStatusMock.mockResolvedValue({ data: { exists: false }, error: null });
    sendEmailCodeMock.mockResolvedValue({
      data: { success: true },
      error: null,
    });
  });

  it("emails a code to a new address on Continue, so step 2 opens on it", async () => {
    const user = userEvent.setup();
    render(<SignUpFlow lastUsedMethod={null} />);

    await continueWith(user, "ada@example.com");

    await waitFor(() => {
      expect(signUpFormMock).toHaveBeenCalled();
    });
    expect(sendEmailCodeMock).toHaveBeenCalledWith({
      fetchOptions: captchaFetchOptions,
      email: "ada@example.com",
      type: "sign-in",
    });
    expect(signUpFormMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        emailCode: expect.objectContaining({ sentTo: "ada@example.com" }),
      }),
    );
  });

  it("opens step 2 on the password when the code could not be sent", async () => {
    sendEmailCodeMock.mockResolvedValue({
      data: null,
      error: { message: "Mail is down" },
    });
    const user = userEvent.setup();
    render(<SignUpFlow lastUsedMethod={null} />);

    await continueWith(user, "ada@example.com");

    await waitFor(() => {
      expect(signUpFormMock).toHaveBeenCalled();
    });
    expect(toast.error).toHaveBeenCalledWith("Mail is down");
    expect(signUpFormMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        emailCode: expect.objectContaining({ sentTo: null }),
      }),
    );
  });

  it("opens on the email step beside the providers", () => {
    render(<SignUpFlow lastUsedMethod="google" returnUrl="/agents" />);

    expect(emailField()).toHaveAttribute("type", "email");
    expect(emailField()).toHaveAttribute("autocomplete", "email");
    expect(emailField()).toHaveAttribute("autocapitalize", "none");
    expect(emailField()).toHaveAttribute("spellcheck", "false");
    expect(emailField()).not.toHaveFocus();
    expect(socialButtonsMock).toHaveBeenCalledWith({
      returnUrl: "/agents",
      lastUsedMethod: "google",
      eventType: "signUp",
      disabled: false,
      onPendingChange: expect.any(Function),
    });
    expect(signUpFormMock).not.toHaveBeenCalled();
  });

  it("does not email a sign-up code while a provider sign-up starts", async () => {
    const user = userEvent.setup();
    render(<SignUpFlow lastUsedMethod={null} />);
    await user.type(emailField(), "ada@example.com");

    const { onPendingChange } = socialButtonsMock.mock.lastCall?.[0] as {
      onPendingChange: (pending: boolean) => void;
    };
    act(() => onPendingChange(true));

    expect(
      screen.getByRole("button", { name: "continueWithEmail" }),
    ).toBeDisabled();
    fireEvent.submit(emailField().closest("form") as HTMLFormElement);
    await act(async () => {});
    expect(emailStatusMock).not.toHaveBeenCalled();
    expect(sendEmailCodeMock).not.toHaveBeenCalled();
  });

  it("stays on the email step while the address is invalid", async () => {
    const user = userEvent.setup();
    render(<SignUpFlow lastUsedMethod={null} />);

    await continueWith(user, "not-an-email");

    expect(await screen.findByText("Email.invalid")).toBeVisible();
    expect(emailStatusMock).not.toHaveBeenCalled();
    expect(signUpFormMock).not.toHaveBeenCalled();
  });

  it("carries the confirmed email to the details step", async () => {
    const user = userEvent.setup();
    render(<SignUpFlow lastUsedMethod={null} returnUrl="/agents" />);

    await continueWith(user, "ada@example.com");

    // Core is asked once, behind the security check, about this address.
    expect(emailStatusMock).toHaveBeenCalledTimes(1);
    expect(emailStatusMock).toHaveBeenCalledWith("/sign-up/email-status", {
      method: "POST",
      body: { email: "ada@example.com" },
      headers: captchaFetchOptions.headers,
    });

    expect(signUpFormMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ email: "ada@example.com" }),
    );
    // The confirmed address stands where the email field was, under its label.
    expect(screen.getByRole("group", { name: "label" })).toHaveTextContent(
      "ada@example.com",
    );
    expect(screen.queryByTestId("social-buttons")).not.toBeInTheDocument();
  });

  // The browser strips the space from what is typed into an email input, but
  // not from an address handed over from sign-in.
  it("checks and carries a handed-over address without its trailing space", async () => {
    const user = userEvent.setup();
    render(
      <SignUpFlow lastUsedMethod={null} prefilledEmail="ada@example.com " />,
    );

    await user.click(screen.getByRole("button", { name: "continueWithEmail" }));

    expect(emailStatusMock).toHaveBeenCalledWith(
      "/sign-up/email-status",
      expect.objectContaining({ body: { email: "ada@example.com" } }),
    );
    expect(signUpFormMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ email: "ada@example.com" }),
    );
  });

  it("starts from the email sign-in handed over, editable", async () => {
    const user = userEvent.setup();
    rememberAuthEmailHint("ada@exmaple.com");

    render(<SignUpFlow lastUsedMethod={null} />);

    await waitFor(() => {
      expect(emailField()).toHaveValue("ada@exmaple.com");
    });
    expect(emailField()).toBeEnabled();

    await user.clear(emailField());
    await continueWith(user, "ada@example.com");

    expect(signUpFormMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ email: "ada@example.com" }),
    );
    expect(
      screen.getByRole("button", { name: "changeEmail" }),
    ).toBeInTheDocument();
  });

  it("opens on step 2 with the code sign-in has just sent", () => {
    rememberAuthEmailHint("ada@example.com", { signUp: { codeSentAt: 1_000 } });

    render(<SignUpFlow lastUsedMethod={null} />);

    // In the same render pass: the email step is never painted.
    expect(signUpFormMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        email: "ada@example.com",
        emailCode: expect.objectContaining({
          sentTo: "ada@example.com",
          sentAt: 1_000,
        }),
      }),
    );
    expect(
      screen.queryByRole("button", { name: "continueWithEmail" }),
    ).not.toBeInTheDocument();
    expect(emailStatusMock).not.toHaveBeenCalled();
    expect(sendEmailCodeMock).not.toHaveBeenCalled();
    expect(takeAuthEmailHint()).toBeNull();
  });

  it("opens on step 2 without a code when sign-in could not send one", () => {
    rememberAuthEmailHint("ada@example.com", { signUp: { codeSentAt: null } });

    render(<SignUpFlow lastUsedMethod={null} />);

    expect(signUpFormMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        email: "ada@example.com",
        emailCode: expect.objectContaining({ sentTo: null }),
      }),
    );
    expect(sendEmailCodeMock).not.toHaveBeenCalled();
  });

  it("keeps the handover through Strict Mode", () => {
    rememberAuthEmailHint("ada@example.com", { signUp: { codeSentAt: 1_000 } });

    render(
      <StrictMode>
        <SignUpFlow lastUsedMethod={null} />
      </StrictMode>,
    );

    expect(signUpFormMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ email: "ada@example.com" }),
    );
    expect(sendEmailCodeMock).not.toHaveBeenCalled();
  });

  it("goes back to the email step with the handed-over address on Change", async () => {
    const user = userEvent.setup();
    rememberAuthEmailHint("ada@example.com", { signUp: { codeSentAt: 1_000 } });
    render(<SignUpFlow lastUsedMethod={null} />);

    await user.click(screen.getByRole("button", { name: "changeEmail" }));

    expect(emailField()).toHaveValue("ada@example.com");
    expect(emailField()).toBeEnabled();
  });

  it("ignores a handover when an invitation supplies the address", async () => {
    rememberAuthEmailHint("ada@example.com", { signUp: { codeSentAt: 1_000 } });
    render(
      <SignUpFlow
        lastUsedMethod={null}
        invitationId="inv_1"
        prefilledEmail="invited@example.com"
      />,
    );
    await act(async () => {});
    expect(emailField()).toHaveValue("invited@example.com");
    expect(emailField()).toBeDisabled();
    expect(signUpFormMock).not.toHaveBeenCalled();
    expect(takeAuthEmailHint()).toBeNull();
  });

  it("keeps signup usable when reading storage fails", async () => {
    rememberAuthEmailHint("ada@example.com", { signUp: { codeSentAt: 1_000 } });
    const storage = vi
      .spyOn(window.sessionStorage, "getItem")
      .mockImplementation(() => {
        throw new Error("blocked");
      });
    render(<SignUpFlow lastUsedMethod={null} />);
    await act(async () => {});
    storage.mockRestore();
    expect(emailField()).toHaveValue("");
    expect(signUpFormMock).not.toHaveBeenCalled();
  });

  it("waits for Continue when the handed-over email was not checked", async () => {
    rememberAuthEmailHint("ada@example.com");

    render(<SignUpFlow lastUsedMethod={null} />);

    await waitFor(() => {
      expect(emailField()).toHaveValue("ada@example.com");
    });
    expect(emailStatusMock).not.toHaveBeenCalled();
    expect(signUpFormMock).not.toHaveBeenCalled();
  });

  it("does not email after leaving while the status check is pending", async () => {
    const user = userEvent.setup();
    let finishStatus!: (result: {
      data: { exists: boolean };
      error: null;
    }) => void;
    emailStatusMock.mockReturnValueOnce(
      new Promise((resolve) => {
        finishStatus = resolve;
      }),
    );
    const view = render(<SignUpFlow lastUsedMethod={null} />);
    await continueWith(user, "ada@example.com");
    await waitFor(() => expect(emailStatusMock).toHaveBeenCalledTimes(1));
    view.unmount();
    await act(async () => {
      finishStatus({ data: { exists: false }, error: null });
    });
    expect(sendEmailCodeMock).not.toHaveBeenCalled();
  });

  it.each(["status captcha", "code captcha"])(
    "does not send after leaving during the %s",
    async (stage) => {
      const user = userEvent.setup();
      let finishCaptcha!: (options: typeof captchaFetchOptions) => void;
      const captcha = new Promise<typeof captchaFetchOptions>((resolve) => {
        finishCaptcha = resolve;
      });
      if (stage === "code captcha")
        requestCaptchaMock.mockResolvedValueOnce(captchaFetchOptions);
      requestCaptchaMock.mockReturnValueOnce(captcha);
      const view = render(<SignUpFlow lastUsedMethod={null} />);
      await continueWith(user, "ada@example.com");
      await waitFor(() =>
        expect(requestCaptchaMock).toHaveBeenCalledTimes(
          stage === "code captcha" ? 2 : 1,
        ),
      );
      view.unmount();
      await act(async () => {
        finishCaptcha(captchaFetchOptions);
      });
      expect(sendEmailCodeMock).not.toHaveBeenCalled();
      expect(signUpFormMock).not.toHaveBeenCalled();
    },
  );

  it("does not show an abandoned send's transport error on the next page", async () => {
    const user = userEvent.setup();
    let failSend!: (error: Error) => void;
    sendEmailCodeMock.mockReturnValueOnce(
      new Promise((_resolve, reject) => {
        failSend = reject;
      }),
    );
    const view = render(<SignUpFlow lastUsedMethod={null} />);
    await continueWith(user, "ada@example.com");
    await waitFor(() => expect(sendEmailCodeMock).toHaveBeenCalledTimes(1));
    view.unmount();
    await act(async () => {
      failSend(new Error("disconnected"));
    });
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("ignores a status response for an address that changed", async () => {
    const user = userEvent.setup();
    let finishStatus!: (result: {
      data: { exists: boolean };
      error: null;
    }) => void;
    emailStatusMock.mockReturnValueOnce(
      new Promise((resolve) => {
        finishStatus = resolve;
      }),
    );
    render(<SignUpFlow lastUsedMethod={null} />);
    await continueWith(user, "ada@example.com");
    await waitFor(() => expect(emailStatusMock).toHaveBeenCalledTimes(1));
    // Programmatic/autofill changes can arrive even while the fieldset is disabled.
    fireEvent.change(emailField(), { target: { value: "bob@example.com" } });
    await act(async () => {
      finishStatus({ data: { exists: false }, error: null });
    });
    expect(sendEmailCodeMock).not.toHaveBeenCalled();
    expect(signUpFormMock).not.toHaveBeenCalled();
    expect(emailField()).toHaveValue("bob@example.com");
  });

  it("uses the handed-over email once", async () => {
    rememberAuthEmailHint("ada@example.com");
    const first = render(<SignUpFlow lastUsedMethod={null} />);
    await waitFor(() => {
      expect(emailField()).toHaveValue("ada@example.com");
    });
    first.unmount();

    render(<SignUpFlow lastUsedMethod={null} />);

    expect(emailField()).toHaveValue("");
  });

  describe("an address that has an account", () => {
    beforeEach(() => {
      emailStatusMock.mockResolvedValue({
        data: { exists: true, hasPassword: false },
        error: null,
      });
    });

    it("emails a code and hands the address to Log in's second step", async () => {
      const user = userEvent.setup();
      mockSearchParams = new URLSearchParams({ returnUrl: "/agents" });
      render(<SignUpFlow lastUsedMethod={null} />);

      await continueWith(user, "ada@example.com");

      await waitFor(() =>
        expect(pushMock).toHaveBeenCalledWith("/signin?returnUrl=%2Fagents"),
      );
      expect(sendEmailCodeMock).toHaveBeenCalledWith({
        fetchOptions: captchaFetchOptions,
        email: "ada@example.com",
        type: "sign-in",
      });
      expect(takeSignInHandover()).toEqual({
        email: "ada@example.com",
        method: "code",
        codeSentAt: expect.any(Number),
      });
      // No notice and no second click: Continue itself goes to Log in.
      expect(screen.getByTestId("email-step-detour")).toHaveAttribute(
        "data-state",
        "closed",
      );
      expect(
        screen.queryByRole("link", { name: "AccountExists.logIn" }),
      ).not.toBeInTheDocument();
      expect(signUpFormMock).not.toHaveBeenCalled();
    });

    it("holds the step and the providers while Log in loads", async () => {
      const user = userEvent.setup();
      render(<SignUpFlow lastUsedMethod={null} />);

      await continueWith(user, "ada@example.com");

      await waitFor(() => expect(pushMock).toHaveBeenCalledTimes(1));
      expect(emailField()).toBeDisabled();
      // Continue keeps spinning until the page has gone.
      const continueButton = screen.getByRole("button", {
        name: "continueWithEmail",
      });
      expect(continueButton).toBeDisabled();
      expect(continueButton.querySelector(".animate-spin")).not.toBeNull();
      expect(socialButtonsMock).toHaveBeenLastCalledWith(
        expect.objectContaining({ disabled: true }),
      );
    });

    it("sends no code to an account with a password", async () => {
      const user = userEvent.setup();
      emailStatusMock.mockResolvedValue({
        data: { exists: true, hasPassword: true },
        error: null,
      });
      render(<SignUpFlow lastUsedMethod={null} />);

      await continueWith(user, "ada@example.com");

      await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/signin"));
      expect(sendEmailCodeMock).not.toHaveBeenCalled();
      expect(takeSignInHandover()).toEqual({
        email: "ada@example.com",
        method: "password",
      });
    });

    it("sends no code when this browser last logged in with a password", async () => {
      const user = userEvent.setup();
      render(<SignUpFlow lastUsedMethod="email" />);

      await continueWith(user, "ada@example.com");

      await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/signin"));
      expect(sendEmailCodeMock).not.toHaveBeenCalled();
      expect(takeSignInHandover()).toEqual({
        email: "ada@example.com",
        method: "password",
      });
    });

    it("still hands over when the code could not be sent", async () => {
      const user = userEvent.setup();
      sendEmailCodeMock.mockResolvedValue({
        data: null,
        error: { message: "Too many requests", status: 429 },
      });
      render(<SignUpFlow lastUsedMethod={null} />);

      await continueWith(user, "ada@example.com");

      await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/signin"));
      expect(takeSignInHandover()).toEqual({
        email: "ada@example.com",
        method: "code",
        codeSentAt: null,
      });
    });

    it("keeps a product's request to create an account on the way to Log in", async () => {
      const user = userEvent.setup();
      mockSearchParams = new URLSearchParams({
        client_id: "cmo",
        redirect_uri: "https://cmo.xyz/callback",
        prompt: "create",
        exp: "1772367377",
        sig: "abc",
      });
      render(<SignUpFlow lastUsedMethod={null} />);

      await continueWith(user, "ada@example.com");

      await waitFor(() =>
        expect(pushMock).toHaveBeenCalledWith(
          "/signin?client_id=cmo&redirect_uri=https%3A%2F%2Fcmo.xyz%2Fcallback&prompt=create&exp=1772367377&sig=abc",
        ),
      );
    });

    it("stays when the address is edited while the code is on its way", async () => {
      const user = userEvent.setup();
      let finishSend!: (result: { data: unknown; error: null }) => void;
      sendEmailCodeMock.mockReturnValueOnce(
        new Promise((resolve) => {
          finishSend = resolve;
        }),
      );
      render(<SignUpFlow lastUsedMethod={null} />);
      await continueWith(user, "ada@example.com");
      await waitFor(() => expect(sendEmailCodeMock).toHaveBeenCalledTimes(1));

      fireEvent.change(emailField(), { target: { value: "bob@example.com" } });
      await act(async () => {
        finishSend({ data: { success: true }, error: null });
      });

      expect(pushMock).not.toHaveBeenCalled();
      expect(takeSignInHandover()).toBeNull();
    });
  });

  it("stays on the email step when the check fails", async () => {
    const user = userEvent.setup();
    emailStatusMock.mockResolvedValue({
      data: null,
      error: { status: 429, statusText: "", message: "Too many requests" },
    });
    render(<SignUpFlow lastUsedMethod={null} />);

    await continueWith(user, "ada@example.com");

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("Too many requests");
    });
    expect(signUpFormMock).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: "continueWithEmail" }),
    ).toBeEnabled();
  });

  it("says to start again when the OAuth request expired before the first step", async () => {
    const user = userEvent.setup();
    emailStatusMock.mockResolvedValue({
      data: null,
      error: { status: 400, statusText: "", error: "invalid_signature" },
    });
    render(<SignUpFlow lastUsedMethod={null} />);

    await continueWith(user, "ada@example.com");

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("errorDescription");
    });
    expect(signUpFormMock).not.toHaveBeenCalled();
  });

  it("asks Core nothing when the security check is cancelled", async () => {
    const user = userEvent.setup();
    requestCaptchaMock.mockResolvedValueOnce(null);
    render(<SignUpFlow lastUsedMethod={null} />);

    await continueWith(user, "ada@example.com");

    expect(emailStatusMock).not.toHaveBeenCalled();
    expect(signUpFormMock).not.toHaveBeenCalled();
  });

  it("starts from the email sign-in handed over, editable", async () => {
    rememberAuthEmailHint("new@example.com");

    render(<SignUpFlow lastUsedMethod={null} />);

    await waitFor(() => expect(emailField()).toHaveValue("new@example.com"));
    expect(emailField()).toBeEnabled();
    expect(takeAuthEmailHint()).toBeNull();
  });

  it("returns to the email step with the address kept and focused", async () => {
    const user = userEvent.setup();
    render(<SignUpFlow lastUsedMethod={null} />);
    await continueWith(user, "ada@example.com");

    await user.click(screen.getByRole("button", { name: "changeEmail" }));

    expect(emailField()).toHaveValue("ada@example.com");
    expect(emailField()).toHaveFocus();
    expect(screen.getByTestId("social-buttons")).toBeInTheDocument();
  });

  it("locks an invitation's email on both steps", async () => {
    const user = userEvent.setup();
    render(
      <SignUpFlow
        lastUsedMethod={null}
        prefilledEmail="invited@example.com"
        invitationId="inv_1"
      />,
    );

    expect(emailField()).toBeDisabled();
    expect(emailField()).toHaveValue("invited@example.com");

    await user.click(screen.getByRole("button", { name: "continueWithEmail" }));

    expect(signUpFormMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ email: "invited@example.com" }),
    );
    expect(screen.getByRole("group", { name: "label" })).toHaveTextContent(
      "invited@example.com",
    );
    expect(
      screen.queryByRole("button", { name: "changeEmail" }),
    ).not.toBeInTheDocument();
  });

  it("keeps a locked invitation email over a handed-over one", () => {
    rememberAuthEmailHint("ada@example.com");

    render(
      <SignUpFlow
        lastUsedMethod={null}
        prefilledEmail="invited@example.com"
        invitationId="inv_1"
      />,
    );

    expect(emailField()).toHaveValue("invited@example.com");
    expect(emailField()).toBeDisabled();
    // Taken all the same, so it does not turn up on a later visit.
    expect(takeAuthEmailHint()).toBeNull();
  });

  it("consumes storage only after hydration", async () => {
    rememberAuthEmailHint("ada@example.com");
    const ui = <SignUpFlow lastUsedMethod={null} />;
    const container = document.createElement("div");
    container.innerHTML = renderToString(ui);
    document.body.append(container);
    expect(container.querySelector("input[name=email]")).toHaveValue("");
    expect(window.sessionStorage.getItem("auth-email-hint")).toBe(
      "ada@example.com",
    );
    const errors = vi.spyOn(console, "error");
    const root = hydrateRoot(container, ui);
    try {
      await waitFor(() =>
        expect(container.querySelector("input[name=email]")).toHaveValue(
          "ada@example.com",
        ),
      );
      expect(takeAuthEmailHint()).toBeNull();
      expect(errors).not.toHaveBeenCalled();
    } finally {
      await act(() => root.unmount());
      container.remove();
      errors.mockRestore();
    }
  });

  it("keeps a normal query email over an unrelated hint", () => {
    rememberAuthEmailHint("stale@example.com");
    render(
      <SignUpFlow lastUsedMethod={null} prefilledEmail="query@example.com" />,
    );
    expect(emailField()).toHaveValue("query@example.com");
    expect(takeAuthEmailHint()).toBeNull();
  });

  it("keeps the hint through Strict Mode and the details Change round trip", async () => {
    const user = userEvent.setup();
    rememberAuthEmailHint("ada@example.com");
    render(
      <StrictMode>
        <SignUpFlow lastUsedMethod={null} />
      </StrictMode>,
    );
    expect(emailField()).toHaveValue("ada@example.com");
    await user.click(screen.getByRole("button", { name: "continueWithEmail" }));
    await screen.findByRole("button", { name: "changeEmail" });
    rememberAuthEmailHint("stale@example.com");
    await user.click(screen.getByRole("button", { name: "changeEmail" }));
    expect(emailField()).toHaveValue("ada@example.com");
    expect(takeAuthEmailHint()).toBeNull();
  });

  it("leaves an email from the query editable without an invitation", async () => {
    const user = userEvent.setup();
    render(
      <SignUpFlow lastUsedMethod={null} prefilledEmail="ada@exmaple.com" />,
    );

    expect(emailField()).toBeEnabled();
    expect(emailField()).toHaveValue("ada@exmaple.com");

    await user.clear(emailField());
    await continueWith(user, "ada@example.com");

    expect(signUpFormMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ email: "ada@example.com" }),
    );
    expect(
      screen.getByRole("button", { name: "changeEmail" }),
    ).toBeInTheDocument();
  });

  it("focuses the recovery link when an invitation email already exists", async () => {
    const user = userEvent.setup();
    emailStatusMock.mockResolvedValue({ data: { exists: true }, error: null });
    mockSearchParams = new URLSearchParams({
      returnUrl: "/accept-invitation/inv_1",
      invitationId: "inv_1",
    });
    render(
      <SignUpFlow
        lastUsedMethod={null}
        prefilledEmail="invited@example.com"
        invitationId="inv_1"
      />,
    );

    await user.click(screen.getByRole("button", { name: "continueWithEmail" }));

    const recoveryLink = await screen.findByRole("link", {
      name: "AccountExists.logIn",
    });
    await waitFor(() => expect(recoveryLink).toHaveFocus());
    expect(emailField()).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent("AccountExists.title");
    expect(recoveryLink).toHaveAttribute(
      "href",
      "/signin?returnUrl=%2Faccept-invitation%2Finv_1&invitationId=inv_1",
    );
  });

  it("counts the register view once and the form start once across steps", async () => {
    const user = userEvent.setup();
    render(<SignUpFlow lastUsedMethod={null} />);
    expect(fireGTMEvent.viewRegisterArea).toHaveBeenCalledTimes(1);
    expect(fireGTMEvent.registerFormStart).not.toHaveBeenCalled();

    await continueWith(user, "ada@example.com");
    await user.click(screen.getByRole("button", { name: "type in details" }));

    expect(fireGTMEvent.viewRegisterArea).toHaveBeenCalledTimes(1);
    expect(fireGTMEvent.registerFormStart).toHaveBeenCalledTimes(1);
  });

  it("links to sign-in without a query when there is no OAuth request", () => {
    render(<SignUpFlow lastUsedMethod={null} />);

    expect(screen.getByRole("link", { name: "Login.link" })).toHaveAttribute(
      "href",
      "/signin",
    );
  });

  it("carries the OAuth request on the sign-in link and into the details step", async () => {
    const user = userEvent.setup();
    mockSearchParams = new URLSearchParams({
      client_id: "test-client",
      redirect_uri: "https://consumer.example.com/callback",
      code_challenge: "test-challenge",
      exp: "1772367377",
      sig: "abc+def/ghi=",
    });

    render(
      <SignUpFlow
        lastUsedMethod={null}
        client={{ name: "CMO", uri: undefined, logoUri: undefined }}
      />,
    );

    expect(screen.getByRole("link", { name: "Login.link" })).toHaveAttribute(
      "href",
      "/signin?client_id=test-client&redirect_uri=https%3A%2F%2Fconsumer.example.com%2Fcallback&code_challenge=test-challenge&exp=1772367377&sig=abc%2Bdef%2Fghi%3D",
    );
    expect(screen.getByText("descriptionFor:CMO")).toBeVisible();

    await continueWith(user, "ada@example.com");

    expect(signUpFormMock).toHaveBeenCalled();
  });

  it("shows what the page passes in under the methods of both steps", async () => {
    const user = userEvent.setup();
    render(
      <SignUpFlow lastUsedMethod={null}>
        <p>terms notice</p>
      </SignUpFlow>,
    );

    expect(screen.getByText("terms notice")).toBeVisible();

    await continueWith(user, "ada@example.com");

    expect(screen.getByText("terms notice")).toBeVisible();
  });

  it("keeps the returnUrl on the sign-in link", () => {
    mockSearchParams = new URLSearchParams({
      returnUrl: "/accept-invitation/invite_123",
    });

    render(<SignUpFlow lastUsedMethod={null} />);

    expect(screen.getByRole("link", { name: "Login.link" })).toHaveAttribute(
      "href",
      "/signin?returnUrl=%2Faccept-invitation%2Finvite_123",
    );
  });
});
