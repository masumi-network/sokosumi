import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  rememberAuthEmailHint,
  takeAuthEmailHint,
} from "@/lib/auth/auth-email-hint";
import { captchaFetchOptions } from "@/test/auth-captcha-mock";

import SignInFlow from "./sign-in-flow";

const emailStatusMock = vi.fn();
const sendEmailCodeMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("next-intl", () => ({
  useTranslations: () => {
    const t = (key: string) => key;
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
    signIn: { emailOtp: vi.fn() },
  },
  signIn: { email: vi.fn() },
}));
vi.mock("@/components/auth-captcha", () => import("@/test/auth-captcha-mock"));
vi.mock("@/lib/gtm-events", () => ({
  fireGTMEvent: { viewLoginArea: vi.fn(), loginAreaFormStart: vi.fn() },
}));
vi.mock("@/auth/components/social-buttons", () => ({ default: () => null }));

function codeField() {
  return screen.getByRole("textbox", { name: "codeLabel" });
}

// Register found an account for the address and handed it over, so Log in
// opens on its second step with a line saying why.
describe("SignInFlow after Register handed over", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.sessionStorage.clear();
    sendEmailCodeMock.mockResolvedValue({
      data: { success: true },
      error: null,
    });
  });

  it("opens on the code Register sent, saying why", () => {
    rememberAuthEmailHint("ada@example.com", {
      signIn: { method: "code", codeSentAt: Date.now() },
    });

    render(<SignInFlow lastUsedMethod={null} />);

    expect(codeField()).toBeVisible();
    expect(screen.getByText("Handover.codeSent")).toBeVisible();
    expect(screen.getByTestId("confirmed-email")).toHaveTextContent(
      "ada@example.com",
    );
    expect(
      screen.queryByRole("textbox", { name: "label" }),
    ).not.toBeInTheDocument();
    // The code is on its way; the resend waits.
    expect(screen.getByRole("button", { name: /resendIn/ })).toBeDisabled();
    expect(emailStatusMock).not.toHaveBeenCalled();
    expect(sendEmailCodeMock).not.toHaveBeenCalled();
    expect(takeAuthEmailHint()).toBeNull();
  });

  it("opens on the password for an account that logs in with one, sending nothing", () => {
    rememberAuthEmailHint("ada@example.com", {
      signIn: { method: "password" },
    });

    render(<SignInFlow lastUsedMethod={null} />);

    expect(screen.getByLabelText("Fields.Password.label")).toBeVisible();
    expect(screen.getByText("Handover.password")).toBeVisible();
    expect(
      screen.queryByRole("textbox", { name: "codeLabel" }),
    ).not.toBeInTheDocument();
    expect(sendEmailCodeMock).not.toHaveBeenCalled();
  });

  it("opens on the code field with a way to send it again when Register could not send it", async () => {
    const user = userEvent.setup();
    rememberAuthEmailHint("ada@example.com", {
      signIn: { method: "code", codeSentAt: null },
    });

    render(<SignInFlow lastUsedMethod={null} />);

    expect(codeField()).toBeVisible();
    expect(screen.getByText("Handover.codeNotSentNotice")).toBeVisible();
    expect(screen.getByText("Handover.codeNotSent")).toBeVisible();
    // Nothing claims a code went out.
    expect(screen.queryByText("Handover.codeSent")).not.toBeInTheDocument();
    expect(screen.queryByText("sentNoAddress")).not.toBeInTheDocument();
    const resend = screen.getByRole("button", { name: "resend" });
    expect(resend).toBeEnabled();

    await user.click(resend);

    await waitFor(() =>
      expect(sendEmailCodeMock).toHaveBeenCalledWith({
        fetchOptions: captchaFetchOptions,
        email: "ada@example.com",
        type: "sign-in",
      }),
    );
    await waitFor(() =>
      expect(
        screen.queryByText("Handover.codeNotSent"),
      ).not.toBeInTheDocument(),
    );
    expect(codeField()).toBeVisible();
  });

  it("ignores the handover when an invitation locks the address", async () => {
    rememberAuthEmailHint("ada@example.com", {
      signIn: { method: "code", codeSentAt: Date.now() },
    });

    render(
      <SignInFlow
        lastUsedMethod={null}
        prefilledEmail="invited@example.com"
        invitationId="inv_1"
      />,
    );
    await act(async () => {});

    expect(screen.getByLabelText("label")).toHaveValue("invited@example.com");
    expect(screen.getByLabelText("label")).toBeDisabled();
    expect(
      screen.queryByRole("textbox", { name: "codeLabel" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Handover.codeSent")).not.toBeInTheDocument();
    expect(takeAuthEmailHint()).toBeNull();
  });

  it("opens on the email step without a handover", () => {
    rememberAuthEmailHint("ada@example.com");

    render(<SignInFlow lastUsedMethod={null} />);

    expect(screen.getByLabelText("label")).toBeEnabled();
    expect(
      screen.queryByRole("textbox", { name: "codeLabel" }),
    ).not.toBeInTheDocument();
  });
});
