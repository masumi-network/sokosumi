import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  rememberAuthEmailHint,
  takeAuthEmailHint,
} from "@/lib/auth/auth-email-hint";
import { fireGTMEvent } from "@/lib/gtm-events";
import {
  captchaFetchOptions,
  requestCaptchaMock,
} from "@/test/auth-captcha-mock";

import SignUpFlow from "./sign-up-flow";

const socialButtonsMock = vi.fn();
const signUpFormMock = vi.fn();
const magicLinkMock = vi.fn();
const emailStatusMock = vi.fn();

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
  },
}));

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

vi.mock("./magic-link", () => ({
  SignUpMagicLink: (props: unknown) => {
    magicLinkMock(props);
    return <div data-testid="magic-link" />;
  },
}));

function emailField() {
  return screen.getByLabelText("Fields.Email.label");
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
  });

  it("opens on the email step beside the providers, without Magic Link", () => {
    render(
      <SignUpFlow showMagicLink lastUsedMethod="google" returnUrl="/agents" />,
    );

    expect(emailField()).toHaveAttribute("type", "email");
    expect(emailField()).toHaveAttribute("autocomplete", "email");
    expect(emailField()).toHaveAttribute("autocapitalize", "none");
    expect(emailField()).toHaveAttribute("spellcheck", "false");
    expect(emailField()).not.toHaveFocus();
    expect(socialButtonsMock).toHaveBeenCalledWith({
      returnUrl: "/agents",
      lastUsedMethod: "google",
    });
    expect(signUpFormMock).not.toHaveBeenCalled();
    expect(screen.queryByTestId("magic-link")).not.toBeInTheDocument();
  });

  it("stays on the email step while the address is invalid", async () => {
    const user = userEvent.setup();
    render(<SignUpFlow showMagicLink lastUsedMethod={null} />);

    await continueWith(user, "not-an-email");

    expect(await screen.findByText("Email.invalid")).toBeVisible();
    expect(emailStatusMock).not.toHaveBeenCalled();
    expect(signUpFormMock).not.toHaveBeenCalled();
  });

  it("carries the confirmed email to the details step and the Magic Link", async () => {
    const user = userEvent.setup();
    render(
      <SignUpFlow showMagicLink lastUsedMethod={null} returnUrl="/agents" />,
    );

    await continueWith(user, "ada@example.com");

    // Core is asked once, behind the security check, about this address.
    expect(emailStatusMock).toHaveBeenCalledTimes(1);
    expect(emailStatusMock).toHaveBeenCalledWith("/sign-up/email-status", {
      method: "POST",
      body: { email: "ada@example.com" },
      headers: captchaFetchOptions.headers,
    });

    expect(signUpFormMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        email: "ada@example.com",
        returnUrl: "/agents",
      }),
    );
    expect(magicLinkMock).toHaveBeenLastCalledWith({
      email: "ada@example.com",
      returnUrl: "/agents",
    });
    // The confirmed address stands where the email field was, under its label.
    expect(
      screen.getByRole("group", { name: "Fields.Email.label" }),
    ).toHaveTextContent("ada@example.com");
    expect(screen.queryByTestId("social-buttons")).not.toBeInTheDocument();
  });

  // The browser strips the space from what is typed into an email input, but
  // not from an address handed over from sign-in.
  it("checks and carries a handed-over address without its trailing space", async () => {
    const user = userEvent.setup();
    render(
      <SignUpFlow
        showMagicLink
        lastUsedMethod={null}
        prefilledEmail="ada@example.com "
      />,
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

    render(<SignUpFlow showMagicLink lastUsedMethod={null} />);

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

  it("uses the handed-over email once", async () => {
    rememberAuthEmailHint("ada@example.com");
    const first = render(<SignUpFlow showMagicLink lastUsedMethod={null} />);
    await waitFor(() => {
      expect(emailField()).toHaveValue("ada@example.com");
    });
    first.unmount();

    render(<SignUpFlow showMagicLink lastUsedMethod={null} />);

    expect(emailField()).toHaveValue("");
  });

  function notice() {
    return screen.getByTestId("sign-up-account-exists");
  }

  function logInLink() {
    return screen.getByRole("link", { name: "AccountExists.logIn" });
  }

  function continueButton() {
    return screen.getByRole("button", { name: "continueWithEmail" });
  }

  it("grows a notice around the button for a person who already has an account", async () => {
    const user = userEvent.setup();
    mockSearchParams = new URLSearchParams({ returnUrl: "/agents" });
    render(<SignUpFlow showMagicLink lastUsedMethod={null} />);
    // Closed: the notice is there for the transition, but says and offers
    // nothing.
    expect(notice()).toHaveAttribute("data-state", "closed");
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
    expect(logInLink()).toHaveAttribute("inert");
    expect(continueButton()).not.toHaveAttribute("inert");

    let resolveStatus:
      | ((result: { data: { exists: boolean }; error: null }) => void)
      | undefined;
    emailStatusMock.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveStatus = resolve;
      }),
    );
    await continueWith(user, "ada@example.com");
    expect(emailField().closest("fieldset")).toBeDisabled();
    expect(notice()).toHaveAttribute("data-state", "closed");
    resolveStatus?.({ data: { exists: true }, error: null });

    await waitFor(() => {
      expect(notice()).toHaveAttribute("data-state", "open");
    });
    expect(screen.getByRole("status")).toHaveTextContent(
      "AccountExists.title. AccountExists.description",
    );
    // The pressed button is out of reach; the one in its place has focus and
    // is described by the notice.
    expect(continueButton()).toHaveAttribute("inert");
    expect(logInLink()).not.toHaveAttribute("inert");
    await waitFor(() => {
      expect(logInLink()).toHaveFocus();
    });
    expect(logInLink()).toHaveAccessibleDescription(
      "AccountExists.title. AccountExists.description",
    );
    expect(logInLink()).toHaveAttribute("href", "/signin?returnUrl=%2Fagents");
    // The submit button is positioned for its spinner. Unless the link is
    // positioned too, it paints underneath and the old label shows through.
    expect(logInLink()).toHaveClass("relative");
    // Having an account is not a mistake in the field.
    expect(emailField()).not.toHaveAttribute("aria-invalid", "true");
    expect(signUpFormMock).not.toHaveBeenCalled();
  });

  describe("after the notice has opened", () => {
    let now = 0;

    beforeEach(() => {
      now = 1_000;
      vi.spyOn(performance, "now").mockImplementation(() => now);
      emailStatusMock.mockResolvedValue({
        data: { exists: true },
        error: null,
      });
    });

    afterEach(() => {
      vi.mocked(performance.now).mockRestore();
    });

    async function openNotice() {
      const user = userEvent.setup();
      render(<SignUpFlow showMagicLink lastUsedMethod={null} />);
      await continueWith(user, "ada@example.com");
      await waitFor(() => {
        expect(notice()).toHaveAttribute("data-state", "open");
      });
    }

    it("hands the typed email to sign-in when the person logs in", async () => {
      await openNotice();
      // The address is not in the link: sign-in locks an email that arrives
      // in its query.
      expect(logInLink()).toHaveAttribute("href", "/signin");

      now += 401;
      fireEvent.click(logInLink());

      expect(takeAuthEmailHint()).toBe("ada@example.com");
    });

    it("ignores the second click of a double-click on the button it replaced", async () => {
      await openNotice();

      now += 150;
      const followed = fireEvent.click(logInLink());

      expect(followed).toBe(false);
      expect(takeAuthEmailHint()).toBeNull();
    });
  });

  it("folds the notice away once the address is edited", async () => {
    const user = userEvent.setup();
    emailStatusMock.mockResolvedValueOnce({
      data: { exists: true },
      error: null,
    });
    render(<SignUpFlow showMagicLink lastUsedMethod={null} />);
    await continueWith(user, "ada@example.com");
    await waitFor(() => {
      expect(notice()).toHaveAttribute("data-state", "open");
    });

    await user.type(emailField(), ".uk");

    expect(notice()).toHaveAttribute("data-state", "closed");
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
    expect(logInLink()).toHaveAttribute("inert");
    expect(continueButton()).not.toHaveAttribute("inert");

    await user.click(continueButton());

    expect(signUpFormMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ email: "ada@example.com.uk" }),
    );
  });

  it("stays on the email step when the check fails", async () => {
    const user = userEvent.setup();
    emailStatusMock.mockResolvedValue({
      data: null,
      error: { status: 429, statusText: "", message: "Too many requests" },
    });
    render(<SignUpFlow showMagicLink lastUsedMethod={null} />);

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
    render(<SignUpFlow showMagicLink={false} lastUsedMethod={null} />);

    await continueWith(user, "ada@example.com");

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("errorDescription");
    });
    expect(signUpFormMock).not.toHaveBeenCalled();
  });

  it("asks Core nothing when the security check is cancelled", async () => {
    const user = userEvent.setup();
    requestCaptchaMock.mockResolvedValueOnce(null);
    render(<SignUpFlow showMagicLink lastUsedMethod={null} />);

    await continueWith(user, "ada@example.com");

    expect(emailStatusMock).not.toHaveBeenCalled();
    expect(signUpFormMock).not.toHaveBeenCalled();
  });

  it("returns to the email step with the address kept and focused", async () => {
    const user = userEvent.setup();
    render(<SignUpFlow showMagicLink lastUsedMethod={null} />);
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
        showMagicLink
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
    expect(
      screen.getByRole("group", { name: "Fields.Email.label" }),
    ).toHaveTextContent("invited@example.com");
    expect(
      screen.queryByRole("button", { name: "changeEmail" }),
    ).not.toBeInTheDocument();
  });

  it("keeps a locked invitation email over a handed-over one", () => {
    rememberAuthEmailHint("ada@example.com");

    render(
      <SignUpFlow
        showMagicLink
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

  it("leaves an email from the query editable without an invitation", async () => {
    const user = userEvent.setup();
    render(
      <SignUpFlow
        showMagicLink
        lastUsedMethod={null}
        prefilledEmail="ada@exmaple.com"
      />,
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
    });
    render(
      <SignUpFlow
        showMagicLink
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
      "/signin?returnUrl=%2Faccept-invitation%2Finv_1",
    );
  });

  it("counts the register view once and the form start once across steps", async () => {
    const user = userEvent.setup();
    render(<SignUpFlow showMagicLink lastUsedMethod={null} />);
    expect(fireGTMEvent.viewRegisterArea).toHaveBeenCalledTimes(1);
    expect(fireGTMEvent.registerFormStart).not.toHaveBeenCalled();

    await continueWith(user, "ada@example.com");
    await user.click(screen.getByRole("button", { name: "type in details" }));

    expect(fireGTMEvent.viewRegisterArea).toHaveBeenCalledTimes(1);
    expect(fireGTMEvent.registerFormStart).toHaveBeenCalledTimes(1);
  });

  it("links to sign-in without a query when there is no OAuth request", () => {
    render(<SignUpFlow showMagicLink lastUsedMethod={null} />);

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
        showMagicLink={false}
        client={{ name: "CMO", uri: undefined, logoUri: undefined }}
      />,
    );

    expect(screen.getByRole("link", { name: "Login.link" })).toHaveAttribute(
      "href",
      "/signin?client_id=test-client&redirect_uri=https%3A%2F%2Fconsumer.example.com%2Fcallback&code_challenge=test-challenge&exp=1772367377&sig=abc%2Bdef%2Fghi%3D",
    );
    expect(screen.getByText("descriptionFor:CMO")).toBeVisible();

    await continueWith(user, "ada@example.com");

    // A magic link opened in another browser cannot return to the product
    // that sent the person here, so the step offers none.
    expect(signUpFormMock).toHaveBeenCalled();
    expect(screen.queryByTestId("magic-link")).not.toBeInTheDocument();
  });

  it("shows what the page passes in under the methods of both steps", async () => {
    const user = userEvent.setup();
    render(
      <SignUpFlow showMagicLink lastUsedMethod={null}>
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

    render(<SignUpFlow showMagicLink lastUsedMethod={null} />);

    expect(screen.getByRole("link", { name: "Login.link" })).toHaveAttribute(
      "href",
      "/signin?returnUrl=%2Faccept-invitation%2Finvite_123",
    );
  });
});
