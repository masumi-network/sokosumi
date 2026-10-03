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

import { rememberAuthEmailHint } from "@/lib/auth/auth-email-hint";
import type { OAuthRequestClient } from "@/lib/auth/oauth-request.server";

import SignInFlow from "./sign-in-flow";

const emailStatusMock = vi.fn();
const sendEmailCodeMock = vi.fn();
const signInEmailCodeMock = vi.fn();
const signInPasswordMock = vi.fn();
const locationReplaceMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
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
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));
vi.mock("@/lib/auth/auth.client", () => ({
  authClient: {
    $fetch: (...args: unknown[]) => emailStatusMock(...args),
    emailOtp: {
      sendVerificationOtp: (...args: unknown[]) => sendEmailCodeMock(...args),
    },
    signIn: {
      emailOtp: (...args: unknown[]) => signInEmailCodeMock(...args),
    },
  },
  signIn: {
    email: (...args: unknown[]) => signInPasswordMock(...args),
  },
}));
vi.mock("@/lib/auth/auth.utils", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth/auth.utils")>(
    "@/lib/auth/auth.utils",
  );
  return {
    ...actual,
    waitForAuthSession: vi.fn().mockResolvedValue({ id: "session-1" }),
  };
});
vi.mock("@/components/auth-captcha", () => import("@/test/auth-captcha-mock"));
vi.mock("@/lib/gtm-events", () => ({
  fireGTMEvent: {
    viewLoginArea: vi.fn(),
    loginAreaFormStart: vi.fn(),
    signIn: vi.fn(),
  },
}));
vi.mock("@/auth/components/social-buttons", () => ({ default: () => null }));

const CMO: OAuthRequestClient = {
  name: "CMO",
  uri: "https://cmo.xyz",
  logoUri: undefined,
};

function emailField() {
  return screen.getByLabelText("label");
}

function codeField() {
  return screen.getByRole("textbox", { name: "codeLabel" });
}

function chip() {
  return screen.getByTestId("auth-email-chip");
}

async function reachCodeStep(user: ReturnType<typeof userEvent.setup>) {
  await user.type(emailField(), "ada@example.com");
  await user.click(screen.getByRole("button", { name: "continueWithEmail" }));
  return screen.findByRole("textbox", { name: "codeLabel" });
}

// Log in's second step on the shared step layout, driven through the real form.
describe("SignInFlow second step", () => {
  const originalLocation = window.location;

  beforeAll(() => {
    Object.defineProperty(window, "location", {
      configurable: true,
      value: {
        href: "http://localhost/signin",
        origin: "http://localhost",
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
    window.sessionStorage.clear();
    emailStatusMock.mockResolvedValue({
      data: { exists: true, hasPassword: false },
      error: null,
    });
    sendEmailCodeMock.mockResolvedValue({
      data: { success: true },
      error: null,
    });
    signInEmailCodeMock.mockResolvedValue({ data: {}, error: null });
  });

  it("asks to check the email, naming the address on a chip, with no button", async () => {
    const user = userEvent.setup();
    render(
      <SignInFlow lastUsedMethod={null}>
        <p>terms</p>
      </SignInFlow>,
    );

    await reachCodeStep(user);

    expect(
      screen.getByRole("heading", { name: "CodeStep.title" }),
    ).toBeVisible();
    expect(screen.getByText("sentTo")).toBeVisible();
    expect(chip()).toHaveTextContent("ada@example.com");
    expect(screen.queryByRole("button", { name: "submit" })).toBeNull();
    expect(screen.queryByTestId("auth-submit")).toBeNull();
    expect(screen.queryByText("codeLabel")).toBeNull();
    // The status line takes no space until something is checked.
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
    // The links row: the resend countdown and the way to a password.
    expect(screen.getByRole("button", { name: "resendIn:30" })).toBeDisabled();
    expect(screen.getByTestId("auth-use-password")).toHaveAccessibleName(
      "usePassword",
    );
    // Local sign-in tooling still finds the address for password managers.
    expect(screen.getByTestId("auth-field-username")).toHaveValue(
      "ada@example.com",
    );
    expect(screen.getByText("terms")).toBeInTheDocument();
    await waitFor(() => expect(codeField()).toHaveFocus());
  });

  it("logs in on the sixth digit, saying it is checking and then that it worked", async () => {
    const user = userEvent.setup();
    let accept!: (result: { data: object; error: null }) => void;
    signInEmailCodeMock.mockReturnValueOnce(
      new Promise((resolve) => {
        accept = resolve;
      }),
    );
    render(<SignInFlow lastUsedMethod={null} returnUrl="/agents" />);
    await reachCodeStep(user);

    await user.type(codeField(), "042917");

    expect(signInEmailCodeMock).toHaveBeenCalledExactlyOnceWith({
      email: "ada@example.com",
      otp: "042917",
    });
    expect(screen.getByRole("status")).toHaveTextContent("checking");
    expect(codeField()).toBeDisabled();
    expect(chip()).toBeDisabled();

    await act(async () => {
      accept({ data: {}, error: null });
    });

    await waitFor(() =>
      expect(locationReplaceMock).toHaveBeenCalledWith("/agents"),
    );
    expect(screen.getByRole("status")).toHaveTextContent("CodeStep.accepted");
    expect(codeField()).toBeDisabled();
  });

  it("says why a code was refused in the status line and lets the person type again", async () => {
    const user = userEvent.setup();
    signInEmailCodeMock.mockResolvedValueOnce({
      data: null,
      error: { code: "INVALID_OTP", message: "Invalid OTP" },
    });
    render(<SignInFlow lastUsedMethod={null} />);
    await reachCodeStep(user);

    await user.type(codeField(), "000000");

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("invalid"),
    );
    expect(codeField()).toHaveAttribute("aria-invalid", "true");
    expect(codeField()).toHaveAccessibleDescription("invalid");
    expect(codeField()).toHaveValue("");
    await waitFor(() => expect(codeField()).toHaveFocus());

    await user.type(codeField(), "0");
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });

  it("goes back to step 1 from the chip, with the address kept and focused", async () => {
    const user = userEvent.setup();
    render(<SignInFlow lastUsedMethod={null} />);
    await reachCodeStep(user);

    await user.click(screen.getByRole("button", { name: /changeEmail/ }));

    expect(emailField()).toHaveValue("ada@example.com");
    await waitFor(() => expect(emailField()).toHaveFocus());
  });

  it("drops Register's hand-over when the chip goes back to step 1", async () => {
    const user = userEvent.setup();
    rememberAuthEmailHint("ada@example.com", {
      signIn: { method: "code", codeSentAt: Date.now() },
    });
    render(<SignInFlow lastUsedMethod={null} />);
    expect(screen.getByText("Handover.codeSent")).toBeVisible();

    await user.click(chip());
    await user.click(screen.getByRole("button", { name: "continueWithEmail" }));

    expect(await screen.findByTestId("auth-email-chip")).toBeVisible();
    expect(screen.queryByText("Handover.codeSent")).not.toBeInTheDocument();
  });

  it("switches to the password in place from the links row", async () => {
    const user = userEvent.setup();
    render(<SignInFlow lastUsedMethod={null} />);
    await reachCodeStep(user);

    await user.click(screen.getByTestId("auth-use-password"));

    expect(screen.getByTestId("auth-field-currentPassword")).toBeVisible();
    expect(screen.getByTestId("auth-submit")).toBeVisible();
    expect(sendEmailCodeMock).toHaveBeenCalledOnce();
  });

  it("leads back to the product that asked for the log-in", async () => {
    const user = userEvent.setup();
    render(<SignInFlow lastUsedMethod={null} client={CMO} />);

    await reachCodeStep(user);

    expect(screen.getByRole("link", { name: "backTo:CMO" })).toHaveAttribute(
      "href",
      "https://cmo.xyz",
    );
  });

  describe("on the password", () => {
    async function reachPasswordStep(user: ReturnType<typeof userEvent.setup>) {
      emailStatusMock.mockResolvedValue({
        data: { exists: true, hasPassword: true },
        error: null,
      });
      await user.type(emailField(), "ada@example.com");
      await user.click(
        screen.getByRole("button", { name: "continueWithEmail" }),
      );
      return screen.findByTestId("auth-field-currentPassword");
    }

    it("asks for the password under the address chip, with the ways out underneath", async () => {
      const user = userEvent.setup();
      render(<SignInFlow lastUsedMethod={null} />);

      const password = await reachPasswordStep(user);

      expect(
        screen.getByRole("heading", { name: "PasswordStep.title" }),
      ).toBeVisible();
      expect(screen.getByText("PasswordStep.subtitle")).toBeVisible();
      expect(chip()).toHaveTextContent("ada@example.com");
      expect(password).toHaveAccessibleName("Fields.Password.label");
      expect(screen.getByTestId("auth-submit")).toHaveAccessibleName("submit");
      expect(
        screen.getByRole("link", { name: "forgotPassword" }),
      ).toBeVisible();
      expect(screen.getByRole("button", { name: "emailCode" })).toBeVisible();
      expect(sendEmailCodeMock).not.toHaveBeenCalled();
      await waitFor(() => expect(password).toHaveFocus());
    });

    it("logs in with the password and keeps Log in busy while the page leaves", async () => {
      const user = userEvent.setup();
      signInPasswordMock.mockResolvedValue({ data: {}, error: null });
      render(<SignInFlow lastUsedMethod={null} returnUrl="/agents" />);
      const password = await reachPasswordStep(user);

      await user.type(password, "Passw0rd!{Enter}");

      await waitFor(() =>
        expect(locationReplaceMock).toHaveBeenCalledWith("/agents"),
      );
      expect(signInPasswordMock).toHaveBeenCalledWith(
        expect.objectContaining({
          email: "ada@example.com",
          password: "Passw0rd!",
        }),
      );
      expect(screen.getByTestId("auth-submit")).toBeDisabled();
      expect(chip()).toBeDisabled();
    });

    it("emails a code from the links row and moves to it in place", async () => {
      const user = userEvent.setup();
      render(<SignInFlow lastUsedMethod={null} />);
      await reachPasswordStep(user);

      await user.click(screen.getByRole("button", { name: "emailCode" }));

      expect(
        await screen.findByRole("textbox", { name: "codeLabel" }),
      ).toBeVisible();
      expect(sendEmailCodeMock).toHaveBeenCalledOnce();
      expect(
        screen.getByRole("heading", { name: "CodeStep.title" }),
      ).toBeVisible();
    });

    it("goes back to step 1 from the chip", async () => {
      const user = userEvent.setup();
      render(<SignInFlow lastUsedMethod={null} />);
      await reachPasswordStep(user);

      await user.click(chip());

      expect(emailField()).toHaveValue("ada@example.com");
    });
  });
});
