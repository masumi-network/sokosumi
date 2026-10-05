import { betterAuthUserAdditionalFields } from "@sokosumi/utils";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { memoryAdapter } from "better-auth/adapters/memory";
import { betterAuth } from "better-auth/minimal";
import { emailOTP } from "better-auth/plugins/email-otp";
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
import { useEmailCode } from "@/auth/components/use-email-code";
import { useMountEffect } from "@/hooks/use-mount-effect";
import { fireGTMEvent } from "@/lib/gtm-events";

import SignUpForm from "./form";

const EMAIL = "new-user@example.com";

/** Step 2 as the flow mounts it: after Continue, with or without a code out. */
function SignUpStep({
  codeSent,
  onFormStart = () => {},
  onPendingChange = vi.fn(),
}: {
  codeSent: boolean;
  onFormStart?: () => void;
  onPendingChange?: (pending: boolean) => void;
}) {
  const emailCode = useEmailCode({
    eventType: "signUp",
    returnUrl: undefined,
    beforeLeaving: () => mockHandleUtmConversion(),
  });
  useMountEffect(() => {
    if (codeSent) void emailCode.sendCode(EMAIL);
  });
  return (
    <SignUpForm
      email={EMAIL}
      emailCode={emailCode}
      onFormStart={onFormStart}
      onPendingChange={onPendingChange}
    />
  );
}

const mockReplace = vi.fn();
const mockLocationReplace = vi.fn();
const mockSendEmailCode = vi.fn();
const mockEmailCodeSignIn = vi.fn();
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

vi.mock("@/lib/gtm-events", () => ({
  fireGTMEvent: {
    viewRegisterArea: vi.fn(),
    registerFormStart: vi.fn(),
    signUp: vi.fn(),
  },
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
    USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL:
      "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL",
  },
}));

vi.mock("@/lib/actions/auth/action", () => ({
  handleUtmConversion: (...args: unknown[]) => mockHandleUtmConversion(...args),
}));

vi.mock("@/lib/auth/auth.client", () => ({
  authClient: {
    getSession: (...args: unknown[]) => mockGetSession(...args),
    emailOtp: {
      sendVerificationOtp: (...args: unknown[]) => mockSendEmailCode(...args),
    },
    signIn: {
      emailOtp: (...args: unknown[]) => mockEmailCodeSignIn(...args),
    },
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

describe("SignUpForm with a password", () => {
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
    return render(<SignUpStep codeSent onFormStart={onFormStart} />);
  }

  beforeEach(() => {
    onFormStart.mockReset();
    mockReplace.mockReset();
    mockLocationReplace.mockReset();
    mockSendEmailCode.mockReset();
    mockSendEmailCode.mockResolvedValue({
      data: { success: true },
      error: null,
    });
    mockEmailCodeSignIn.mockReset();
    mockHandleUtmConversion.mockReset();
    mockGetSession.mockReset();
    mockWaitForAuthSession.mockReset();
    mockWaitForAuthSession.mockResolvedValue(undefined);
    vi.mocked(fireGTMEvent.signUp).mockClear();
    vi.mocked(toast.error).mockClear();
    mockSearchParams = new URLSearchParams();
    window.location.href = "http://localhost/";
  });

  async function addPassword(user: ReturnType<typeof userEvent.setup>) {
    await screen.findByRole("textbox", { name: "codeLabel" });
    await user.click(screen.getByRole("button", { name: "addPassword" }));
  }

  // Register without the sixth digit completing it: the button is the submit.
  async function submitSignUpForm(password: string, code = "042917") {
    const user = userEvent.setup();

    await addPassword(user);
    await user.type(screen.getByLabelText("Fields.Password.label"), password);
    await user.click(screen.getByRole("textbox", { name: "codeLabel" }));
    await user.paste(code);
    await user.type(screen.getByLabelText("firstNameLabel"), "New");
    await user.type(screen.getByLabelText("lastNameLabel"), "User");
    await user.click(screen.getByRole("button", { name: "submit" }));
  }

  function submitValidSignUpForm() {
    return submitSignUpForm("Passw0rd!");
  }

  it("asks for the names and the code, with updates as the only checkbox", async () => {
    renderForm();

    expect(
      await screen.findByRole("textbox", { name: "codeLabel" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByLabelText("Fields.Password.label"),
    ).not.toBeInTheDocument();
    expect(screen.getAllByRole("checkbox")).toHaveLength(1);
    const updates = screen.getByRole("checkbox", {
      name: "Fields.MarketingOptIn.label",
    });
    expect(updates).not.toBeChecked();
    // The choice closes the profile, so the code leads straight to Register.
    expect(
      updates.compareDocumentPosition(
        screen.getByRole("textbox", { name: "codeLabel" }),
      ) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "submit" })).toBeEnabled();
  });

  it("lets a password manager recognise names, email and new password", async () => {
    const { container } = renderForm();
    await addPassword(userEvent.setup());

    expect(screen.getByLabelText("firstNameLabel")).toHaveAttribute(
      "autocomplete",
      "given-name",
    );
    expect(screen.getByLabelText("lastNameLabel")).toHaveAttribute(
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
    expect(username).toBe(screen.getByTestId("auth-field-username"));
    expect(username).toHaveValue("new-user@example.com");
    expect(username).toHaveAttribute("readonly");
    expect(username).toHaveAttribute("aria-hidden", "true");
    expect(username).toHaveAttribute("type", "email");
    expect(username).toHaveAttribute("autocapitalize", "none");
    expect(username).toHaveAttribute("spellcheck", "false");
  });

  it("stacks the name fields on a phone and pairs them from the sm breakpoint", () => {
    renderForm();

    const lastName = screen.getByLabelText("lastNameLabel");
    let row = screen.getByLabelText("firstNameLabel").parentElement;
    while (row && !row.contains(lastName)) row = row.parentElement;
    expect(row).toHaveClass("grid", "sm:grid-cols-2");
    expect(row).not.toHaveClass("grid-cols-2");
  });

  it("names the names and the password inside their fields, keeping the labels", async () => {
    renderForm();
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "addPassword" }));

    for (const label of [
      "firstNameLabel",
      "lastNameLabel",
      "Fields.Password.label",
    ]) {
      expect(screen.getByLabelText(label)).toHaveAttribute(
        "placeholder",
        label,
      );
    }
    // The code's slots show dots, so its name stays above them.
    expect(
      screen.getByText("codeLabel", { selector: "label" }),
    ).not.toHaveClass("sr-only");
  });

  it("moves focus to the first name when the step opens", async () => {
    renderForm();

    // react-hook-form defers the focus by a tick.
    await waitFor(() => {
      expect(screen.getByLabelText("firstNameLabel")).toHaveFocus();
    });
  });

  it("reports the first input to the flow", async () => {
    const user = userEvent.setup();
    renderForm();
    expect(onFormStart).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText("firstNameLabel"), "N");

    expect(onFormStart).toHaveBeenCalled();
  });

  // The code proves the address, so the new account starts verified.
  it("sends the password with the emailed code, never without it", async () => {
    mockEmailCodeSignIn.mockResolvedValue({
      data: { user: { id: "user-1" } },
      error: null,
    });
    renderForm();

    await submitSignUpForm("abcdefgh");

    await waitFor(() => {
      expect(mockEmailCodeSignIn).toHaveBeenCalledExactlyOnceWith({
        email: EMAIL,
        otp: "042917",
        password: "abcdefgh",
        firstName: "New",
        lastName: "User",
        termsAccepted: true,
        marketingOptIn: false,
      });
    });
  });

  it("asks for the whole code before sending the password", async () => {
    renderForm();

    await submitSignUpForm("Passw0rd!", "0429");

    const code = screen.getByRole("textbox", { name: "codeLabel" });
    await waitFor(() =>
      expect(code).toHaveAccessibleDescription(/incomplete$/),
    );
    expect(mockEmailCodeSignIn).not.toHaveBeenCalled();
  });

  // Only Register sends: the password link sits below it.
  it("waits for Register after the sixth digit follows the names and password", async () => {
    mockEmailCodeSignIn.mockResolvedValue({
      data: { user: { id: "user-1" } },
      error: null,
    });
    const user = userEvent.setup();
    renderForm();
    await addPassword(user);
    await user.type(screen.getByLabelText("firstNameLabel"), "New");
    await user.type(screen.getByLabelText("lastNameLabel"), "User");
    await user.type(
      screen.getByLabelText("Fields.Password.label"),
      "Passw0rd!",
    );

    await user.type(
      screen.getByRole("textbox", { name: "codeLabel" }),
      "042917",
    );
    await act(async () => {});
    expect(mockEmailCodeSignIn).not.toHaveBeenCalled();

    await user.click(
      screen.getByRole("checkbox", { name: "Fields.MarketingOptIn.label" }),
    );
    await user.click(screen.getByRole("button", { name: "submit" }));

    await waitFor(() =>
      expect(mockEmailCodeSignIn).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          otp: "042917",
          password: "Passw0rd!",
          marketingOptIn: true,
        }),
      ),
    );
  });

  it("states the password rule before the first submit", async () => {
    renderForm();
    await addPassword(userEvent.setup());

    expect(screen.getByText("Fields.Password.description")).toBeInTheDocument();
    expect(
      screen.getByLabelText("Fields.Password.label"),
    ).toHaveAccessibleDescription("Fields.Password.description");
  });

  it("rejects a password of seven characters with the stated rule", async () => {
    renderForm();

    await submitSignUpForm("abcdefg");

    expect(await screen.findByText("Password.min")).toBeInTheDocument();
    // The rule reaches a screen reader through the field's description.
    expect(
      screen.getByLabelText("Fields.Password.label"),
    ).toHaveAccessibleDescription("Fields.Password.description Password.min");
    expect(mockEmailCodeSignIn).not.toHaveBeenCalled();
  });

  const existingAccountError = {
    data: null,
    error: {
      code: "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL",
      message: "User already exists. Use another email.",
      status: 422,
    },
  };

  it("offers Log in, keeping the query and the email, when the account exists by now", async () => {
    // e.g. the person signed up with Google in another tab meanwhile.
    mockEmailCodeSignIn.mockResolvedValueOnce(existingAccountError);
    mockSearchParams = new URLSearchParams({ returnUrl: "/agents" });
    renderForm();

    await submitValidSignUpForm();

    const notice = await screen.findByRole("alert");
    expect(notice).toHaveTextContent("AccountExists.title");
    expect(notice).toHaveTextContent("AccountExists.description");
    expect(toast.error).not.toHaveBeenCalled();
    // Core refused before spending the code, so it is not marked wrong.
    expect(
      screen.getByRole("textbox", { name: "codeLabel" }),
    ).not.toHaveAttribute("aria-invalid", "true");
    const logIn = screen.getByRole("link", { name: "AccountExists.logIn" });
    expect(logIn).toHaveAttribute("href", "/signin?returnUrl=%2Fagents");

    window.sessionStorage.clear();
    fireEvent.click(logIn);
    expect(window.sessionStorage.getItem("auth-email-hint")).toBe(EMAIL);
  });

  it("keeps the signed OAuth request on the Log in link", async () => {
    mockEmailCodeSignIn.mockResolvedValueOnce(existingAccountError);
    mockSearchParams = new URLSearchParams({
      client_id: "test-client",
      exp: "1772367377",
      sig: "signed-value",
    });
    renderForm();

    await submitValidSignUpForm();

    const logIn = await screen.findByRole("link", {
      name: "AccountExists.logIn",
    });
    const href = new URL(logIn.getAttribute("href") ?? "", "http://localhost");
    expect(href.pathname).toBe("/signin");
    expect(href.searchParams.get("client_id")).toBe("test-client");
    expect(href.searchParams.get("sig")).toBe("signed-value");
  });

  // Sign-in looks the invitation up and ignores the hint when it locks the
  // address; if the lookup fails, the typed address still arrives.
  it("keeps the invitation on the Log in link and hands the address over", async () => {
    mockEmailCodeSignIn.mockResolvedValueOnce(existingAccountError);
    mockSearchParams = new URLSearchParams({ invitationId: "invitation-1" });
    renderForm();

    await submitValidSignUpForm();

    const logIn = await screen.findByRole("link", {
      name: "AccountExists.logIn",
    });
    expect(logIn.getAttribute("href")).toContain("invitationId=invitation-1");
    expect(logIn.getAttribute("href")).not.toContain("email=");
    fireEvent.click(logIn);
    expect(window.sessionStorage.getItem("auth-email-hint")).toBe(EMAIL);
  });

  it("drops the notice when a later submit fails for another reason", async () => {
    mockEmailCodeSignIn
      .mockResolvedValueOnce(existingAccountError)
      .mockResolvedValueOnce({
        data: null,
        error: { code: "INVALID_OTP", status: 400 },
      });
    renderForm();

    await submitValidSignUpForm();
    await screen.findByRole("alert");
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "submit" }));

    await waitFor(() => {
      expect(mockEmailCodeSignIn).toHaveBeenCalledTimes(2);
    });
    await waitFor(() => {
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });
  });

  // Core checks the length again before spending the code.
  it.each([
    ["PASSWORD_TOO_SHORT", "Password.min"],
    ["PASSWORD_TOO_LONG", "Password.max"],
  ])(
    "marks a password Core refuses with %s on the password field",
    async (code, message) => {
      mockEmailCodeSignIn.mockResolvedValueOnce({
        data: null,
        error: { code, status: 400 },
      });
      renderForm();

      await submitValidSignUpForm();

      await waitFor(() =>
        expect(
          screen.getByLabelText("Fields.Password.label"),
        ).toHaveAccessibleDescription(`Fields.Password.description ${message}`),
      );
      expect(
        screen.getByRole("textbox", { name: "codeLabel" }),
      ).not.toHaveAttribute("aria-invalid", "true");
    },
  );

  it("says to start again when the OAuth request has expired", async () => {
    mockEmailCodeSignIn.mockResolvedValueOnce({
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

  it("renders signup with a single password field", async () => {
    renderForm();
    await addPassword(userEvent.setup());

    expect(
      screen.queryByLabelText("Fields.ConfirmPassword.label"),
    ).not.toBeInTheDocument();
    expect(screen.getByLabelText("Fields.Password.label")).toHaveAttribute(
      "type",
      "password",
    );
  });

  it("takes the password away again and signs up with the code alone", async () => {
    mockEmailCodeSignIn.mockResolvedValue({
      data: { user: { id: "user-1" } },
      error: null,
    });
    const user = userEvent.setup();
    renderForm();
    await addPassword(user);
    await user.type(screen.getByLabelText("Fields.Password.label"), "short");

    await user.click(screen.getByRole("button", { name: "removePassword" }));
    expect(
      screen.queryByLabelText("Fields.Password.label"),
    ).not.toBeInTheDocument();
    await user.type(screen.getByLabelText("firstNameLabel"), "New");
    await user.type(screen.getByLabelText("lastNameLabel"), "User");
    await user.type(
      screen.getByRole("textbox", { name: "codeLabel" }),
      "042917",
    );
    await user.click(screen.getByRole("button", { name: "submit" }));

    await waitFor(() => expect(mockEmailCodeSignIn).toHaveBeenCalledOnce());
    expect(mockEmailCodeSignIn.mock.calls[0]?.[0]).not.toHaveProperty(
      "password",
    );
  });

  it("counts the signup in place, once, and leaves with a full document load", async () => {
    mockEmailCodeSignIn.mockResolvedValue({
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

    const signUpPayload = mockEmailCodeSignIn.mock.calls[0]?.[0] as Record<
      string,
      unknown
    >;
    expect(signUpPayload).not.toHaveProperty("callbackURL");
    expect(fireGTMEvent.signUp).toHaveBeenCalledExactlyOnceWith("credential");
    // A soft nav would be served the pre-signup middleware redirect.
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("does not count a signup when no session appears", async () => {
    mockEmailCodeSignIn.mockResolvedValue({
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

  it("passes unwrapped session data to waitForAuthSession after password signup", async () => {
    mockEmailCodeSignIn.mockResolvedValue({
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

    mockEmailCodeSignIn.mockResolvedValue({
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
      expect(mockEmailCodeSignIn).toHaveBeenCalledTimes(1);
    });

    const signUpPayload = mockEmailCodeSignIn.mock.calls[0]?.[0];

    expect(signUpPayload).toEqual({
      email: "new-user@example.com",
      otp: "042917",
      password: "Passw0rd!",
      firstName: "New",
      lastName: "User",
      termsAccepted: true,
      marketingOptIn: false,
    });

    await waitFor(() => {
      expect(fireGTMEvent.signUp).toHaveBeenCalledWith("credential");
      expect(mockHandleUtmConversion).toHaveBeenCalledTimes(1);
    });
    // Better Auth's client follows the provider's answer. A second
    // navigation would deliver the authorization code twice.
    expect(mockLocationReplace).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("keeps a left-edge submit spinner after password signup succeeds", async () => {
    mockEmailCodeSignIn.mockResolvedValue({
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

  it("releases the submit spinner after password signup fails", async () => {
    mockEmailCodeSignIn.mockResolvedValue({
      data: null,
      error: { code: "INVALID_OTP", status: 400 },
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

describe("SignUpForm email code", () => {
  const originalLocation = window.location;

  beforeAll(() => {
    Object.defineProperty(window, "location", {
      configurable: true,
      value: {
        href: "http://localhost/signup",
        origin: "http://localhost",
        search: "",
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

  // Core's emailOTP plugin, offline and set up as Core sets it: proves the
  // requests this page sends are the ones the plugin accepts. Core's own hook
  // derives the display name.
  function connectToEmailCodeHandler() {
    const db: Record<string, Array<Record<string, unknown>>> = {
      user: [],
      session: [],
      account: [],
      verification: [],
    };
    const emailedCodes: string[] = [];
    const auth = betterAuth({
      baseURL: "https://core.test",
      secret: "offline-email-code-fixture-secret-32-characters",
      trustedOrigins: [window.location.origin],
      database: memoryAdapter(db),
      user: { additionalFields: betterAuthUserAdditionalFields },
      plugins: [
        emailOTP({
          storeOTP: "encrypted",
          resendStrategy: "reuse",
          async sendVerificationOTP({ otp }) {
            emailedCodes.push(otp);
          },
        }),
      ],
      rateLimit: { enabled: false },
    });
    function post(path: string, body: Record<string, unknown>) {
      return auth.handler(
        new Request(`https://core.test/api/auth${path}`, {
          method: "POST",
          headers: {
            origin: window.location.origin,
            "content-type": "application/json",
          },
          body: JSON.stringify(body),
        }),
      );
    }
    mockSendEmailCode.mockImplementation(
      async ({ fetchOptions: _, ...body }: Record<string, unknown>) => {
        const response = await post("/email-otp/send-verification-otp", body);
        expect(response.status).toBe(200);
        return { data: await response.json(), error: null };
      },
    );
    mockEmailCodeSignIn.mockImplementation(
      async (body: Record<string, unknown>) => {
        const response = await post("/sign-in/email-otp", body);
        const json = await response.json();
        return response.ok
          ? { data: json, error: null }
          : { data: null, error: { ...json, status: response.status } };
      },
    );
    return { db, emailedCodes };
  }

  beforeEach(() => {
    mockLocationReplace.mockReset();
    mockSendEmailCode.mockReset();
    mockSendEmailCode.mockResolvedValue({
      data: { success: true },
      error: null,
    });
    mockEmailCodeSignIn.mockReset();
    mockHandleUtmConversion.mockReset();
    mockWaitForAuthSession.mockReset();
    mockWaitForAuthSession.mockResolvedValue(undefined);
    mockSearchParams = new URLSearchParams();
  });

  async function typeNames(user: ReturnType<typeof userEvent.setup>) {
    await user.type(screen.getByLabelText("firstNameLabel"), "Ada");
    await user.type(screen.getByLabelText("lastNameLabel"), "Lovelace");
  }

  it("opens on the code that step 1 sent, without repeating the address", async () => {
    render(<SignUpStep codeSent />);

    const code = await screen.findByRole("textbox", { name: "codeLabel" });
    expect(code).toHaveAccessibleDescription("sentNoAddress");
    expect(
      screen.queryByLabelText("Fields.Password.label"),
    ).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "submit" })).toHaveLength(1);
    expect(
      screen.getByRole("button", { name: "addPassword" }),
    ).toBeInTheDocument();
  });

  it("creates the named account with the emailed code", async () => {
    const { db, emailedCodes } = connectToEmailCodeHandler();
    const user = userEvent.setup();
    render(<SignUpStep codeSent />);
    const code = await screen.findByRole("textbox", { name: "codeLabel" });
    // Left unticked: Better Auth would store its default (true) if the page
    // dropped the choice.
    await typeNames(user);

    await user.type(code, emailedCodes[0] ?? "");
    await user.click(screen.getByRole("button", { name: "submit" }));

    await waitFor(() => {
      expect(mockLocationReplace).toHaveBeenCalled();
    });
    expect(db.user).toEqual([
      expect.objectContaining({
        email: EMAIL,
        emailVerified: true,
        firstName: "Ada",
        lastName: "Lovelace",
        marketingOptIn: false,
        termsAccepted: true,
      }),
    ]);
    expect(mockHandleUtmConversion).toHaveBeenCalledOnce();
  });

  it("waits for Register after the sixth digit, so updates can still be chosen", async () => {
    const { db, emailedCodes } = connectToEmailCodeHandler();
    const user = userEvent.setup();
    render(<SignUpStep codeSent />);
    const code = await screen.findByRole("textbox", { name: "codeLabel" });
    await typeNames(user);

    await user.type(code, emailedCodes[0] ?? "");
    await act(async () => {});
    expect(mockEmailCodeSignIn).not.toHaveBeenCalled();

    await user.click(
      screen.getByRole("checkbox", { name: "Fields.MarketingOptIn.label" }),
    );
    await user.click(screen.getByRole("button", { name: "submit" }));

    await waitFor(() => {
      expect(mockLocationReplace).toHaveBeenCalled();
    });
    expect(mockEmailCodeSignIn).toHaveBeenCalledOnce();
    expect(db.user).toEqual([
      expect.objectContaining({
        firstName: "Ada",
        lastName: "Lovelace",
        marketingOptIn: true,
      }),
    ]);
  });

  it("waits for the button when the code comes before the names", async () => {
    const user = userEvent.setup();
    render(<SignUpStep codeSent />);
    const code = await screen.findByRole("textbox", { name: "codeLabel" });

    await user.click(code);
    await user.paste("042 917");

    expect(mockEmailCodeSignIn).not.toHaveBeenCalled();
    // Nothing new is marked: the names were never submitted.
    expect(screen.getByLabelText("firstNameLabel")).not.toHaveAttribute(
      "aria-invalid",
      "true",
    );
    expect(code).not.toHaveAttribute("aria-invalid", "true");
    expect(code).toHaveFocus();

    // Register still sends it once the names are in.
    mockEmailCodeSignIn.mockResolvedValue({
      data: null,
      error: { code: "INVALID_OTP", message: "Invalid OTP", status: 400 },
    });
    await typeNames(user);
    expect(mockEmailCodeSignIn).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "submit" }));
    await waitFor(() =>
      expect(mockEmailCodeSignIn).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ email: EMAIL, otp: "042917" }),
      ),
    );
  });

  it("sends the code once when Register is pressed twice", async () => {
    mockEmailCodeSignIn.mockReturnValue(new Promise(() => {}));
    const user = userEvent.setup();
    render(<SignUpStep codeSent />);
    const code = await screen.findByRole("textbox", { name: "codeLabel" });
    await typeNames(user);
    const formElement = code.closest("form");
    if (!formElement) throw new Error("Missing sign-up form");

    act(() => {
      fireEvent.change(code, { target: { value: "042917" } });
      fireEvent.submit(formElement);
      fireEvent.submit(formElement);
    });
    await waitFor(() => expect(mockEmailCodeSignIn).toHaveBeenCalledOnce());
    expect(code).toBeDisabled();
    fireEvent.submit(formElement);
    await act(async () => {});
    expect(mockEmailCodeSignIn).toHaveBeenCalledOnce();
    expect(code).toBeDisabled();
  });

  it("keeps the first email's code working after a resend", async () => {
    const { emailedCodes } = connectToEmailCodeHandler();
    const sendCode = (body: Record<string, unknown>) =>
      mockSendEmailCode({ ...body, type: "sign-in" });

    await sendCode({ email: EMAIL });
    await sendCode({ email: EMAIL });

    expect(emailedCodes).toHaveLength(2);
    expect(emailedCodes[1]).toBe(emailedCodes[0]);
  });

  it("asks for the names and the whole code before spending it", async () => {
    const user = userEvent.setup();
    render(<SignUpStep codeSent />);
    const code = await screen.findByRole("textbox", { name: "codeLabel" });
    await user.type(code, "0429");

    await user.click(screen.getByRole("button", { name: "submit" }));

    await waitFor(() => {
      expect(screen.getByLabelText("firstNameLabel")).toHaveAttribute(
        "aria-invalid",
        "true",
      );
    });
    expect(code).toHaveAttribute("aria-invalid", "true");
    expect(code).toHaveAccessibleDescription(/incomplete$/);
    expect(mockEmailCodeSignIn).not.toHaveBeenCalled();
  });

  it("explains a wrong code beside the field and returns focus to it", async () => {
    mockEmailCodeSignIn.mockResolvedValue({
      data: null,
      error: { code: "INVALID_OTP", message: "Invalid OTP", status: 400 },
    });
    const user = userEvent.setup();
    render(<SignUpStep codeSent />);
    const code = await screen.findByRole("textbox", { name: "codeLabel" });
    await typeNames(user);
    await user.type(code, "000000");

    await user.click(screen.getByRole("button", { name: "submit" }));

    await waitFor(() => expect(code).toHaveAccessibleDescription(/invalid$/));
    // The field takes six digits; the refused ones would block the next code.
    expect(code).toHaveValue("");
    await waitFor(() => expect(code).toHaveFocus());
    expect(mockLocationReplace).not.toHaveBeenCalled();

    // Typing replaces the reason, without asking for the rest of the code.
    await user.type(code, "0");
    expect(code).not.toHaveAttribute("aria-invalid");

    await user.type(code, "00000");
    await user.click(screen.getByRole("button", { name: "submit" }));
    await waitFor(() => expect(mockEmailCodeSignIn).toHaveBeenCalledTimes(2));
    expect(mockEmailCodeSignIn).toHaveBeenLastCalledWith(
      expect.objectContaining({ otp: "000000" }),
    );
  });

  it("explains a code check that fails without an answer, so the code can be typed again", async () => {
    mockEmailCodeSignIn
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValue({
        data: null,
        error: { code: "INVALID_OTP", status: 400 },
      });
    const onPendingChange = vi.fn();
    const user = userEvent.setup();
    render(<SignUpStep codeSent onPendingChange={onPendingChange} />);
    const code = await screen.findByRole("textbox", { name: "codeLabel" });
    await typeNames(user);
    await user.type(code, "042917");

    await user.click(screen.getByRole("button", { name: "submit" }));

    // As for a refused code: the field clears, says why and unlocks the step.
    await waitFor(() => expect(code).toHaveAccessibleDescription(/generic$/));
    expect(code).toHaveValue("");
    expect(onPendingChange).toHaveBeenLastCalledWith(false);
    await user.type(code, "042917");
    await user.click(screen.getByRole("button", { name: "submit" }));
    await waitFor(() => expect(mockEmailCodeSignIn).toHaveBeenCalledTimes(2));
  });

  it("drops the existing-account notice when the code is tried alone next", async () => {
    mockEmailCodeSignIn
      .mockResolvedValueOnce({
        data: null,
        error: {
          code: "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL",
          message: "User already exists. Use another email.",
          status: 422,
        },
      })
      .mockResolvedValue({
        data: null,
        error: { code: "INVALID_OTP", message: "Invalid OTP", status: 400 },
      });
    const user = userEvent.setup();
    render(<SignUpStep codeSent />);
    const code = await screen.findByRole("textbox", { name: "codeLabel" });
    await typeNames(user);
    await user.click(screen.getByRole("button", { name: "addPassword" }));
    await user.type(
      screen.getByLabelText("Fields.Password.label"),
      "Passw0rd!",
    );
    await user.click(code);
    await user.paste("042917");
    await user.click(screen.getByRole("button", { name: "submit" }));
    await screen.findByRole("alert");

    await user.click(screen.getByRole("button", { name: "removePassword" }));
    await user.click(screen.getByRole("button", { name: "submit" }));

    await waitFor(() => expect(code).toHaveAccessibleDescription(/invalid$/));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("adds a password beside the code and takes it away, without a new code", async () => {
    const user = userEvent.setup();
    render(<SignUpStep codeSent />);
    await screen.findByRole("textbox", { name: "codeLabel" });

    await user.click(screen.getByRole("button", { name: "addPassword" }));

    expect(screen.getByLabelText("Fields.Password.label")).toBeInTheDocument();
    expect(
      screen.getByRole("textbox", { name: "codeLabel" }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "removePassword" }));

    expect(
      screen.queryByLabelText("Fields.Password.label"),
    ).not.toBeInTheDocument();
    expect(mockSendEmailCode).toHaveBeenCalledTimes(1);
  });

  it("asks for a code even when none went out, and sends one on request", async () => {
    const user = userEvent.setup();
    render(<SignUpStep codeSent={false} />);

    const code = screen.getByRole("textbox", { name: "codeLabel" });
    expect(code).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "resend" }));

    expect(mockSendEmailCode).toHaveBeenCalledWith(
      expect.objectContaining({ email: EMAIL, type: "sign-in" }),
    );
  });
});

vi.mock("@/components/auth-captcha", () => import("@/test/auth-captcha-mock"));
