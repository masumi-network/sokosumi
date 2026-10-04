import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { requestPasswordReset } from "@/lib/auth/auth.client";
import {
  rememberAuthEmailHint,
  takeAuthEmailHint,
} from "@/lib/auth/auth-email-hint";
import {
  captchaErrorMessageMock,
  requestCaptchaMock,
} from "@/test/auth-captcha-mock";

import ForgotPasswordForm from "./form";

const { push, searchParams } = vi.hoisted(() => ({
  push: vi.fn(),
  searchParams: { current: new URLSearchParams() },
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  useSearchParams: () => searchParams.current,
}));
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: { seconds?: number }) =>
    values?.seconds === undefined ? key : `${key} ${values.seconds}`,
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@/lib/auth/auth.client", () => ({ requestPasswordReset: vi.fn() }));
vi.mock("@/components/auth-captcha", () => import("@/test/auth-captcha-mock"));

async function submit() {
  await userEvent.setup().click(screen.getByRole("button", { name: "submit" }));
  await waitFor(() =>
    expect(
      screen.queryByRole("button", { name: "submit" }) ??
        screen.getByRole("heading", { name: "Sent.title" }),
    ).not.toBeDisabled(),
  );
}

/** The request step's one line for a refusal, between the field and the button. */
function errorLine() {
  return screen.getByRole("alert");
}

function sentHeading() {
  return screen.queryByRole("heading", { name: "Sent.title" });
}

function renderWithEmail(email: string) {
  rememberAuthEmailHint(email);
  render(<ForgotPasswordForm />);
}

describe("ForgotPasswordForm", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    window.sessionStorage.clear();
    searchParams.current = new URLSearchParams();
    vi.mocked(requestPasswordReset).mockResolvedValue({
      data: { status: true },
      error: null,
    });
  });

  it("asks for the address in one field named by its placeholder, with an email keyboard and no autocorrect", () => {
    render(<ForgotPasswordForm />);

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "title",
    );
    expect(screen.getByText("description")).toBeInTheDocument();
    const email = screen.getByLabelText("Fields.Email.label");
    expect(email).toBe(screen.getByTestId("auth-field-email"));
    expect(email).toHaveAttribute("placeholder", "Fields.Email.label");
    expect(screen.queryByText("Fields.Email.label")).not.toBeInTheDocument();
    expect(email).toHaveAttribute("type", "email");
    expect(email).toHaveAttribute("autocomplete", "email");
    expect(email).toHaveAttribute("autocapitalize", "none");
    expect(email).toHaveAttribute("spellcheck", "false");
  });

  // The address comes from sign-in through session storage, never the URL,
  // which reaches server logs and analytics.
  it("starts with the address sign-in handed over", async () => {
    renderWithEmail("ada@example.com");

    await waitFor(() =>
      expect(screen.getByTestId("auth-field-email")).toHaveValue(
        "ada@example.com",
      ),
    );
    await submit();

    expect(requestPasswordReset).toHaveBeenCalledWith(
      expect.objectContaining({ email: "ada@example.com" }),
    );
  });

  it("links the email back to where the person was going", async () => {
    searchParams.current = new URLSearchParams("returnUrl=/chat");
    renderWithEmail("ada@example.com");

    await submit();

    expect(requestPasswordReset).toHaveBeenCalledWith(
      expect.objectContaining({
        redirectTo: `${window.location.origin}/reset-password/exchange?returnUrl=%2Fchat`,
      }),
    );
  });

  it("links the email back to the OAuth request it came from", async () => {
    const oauthQuery = "client_id=cmo&exp=1900000000&sig=abc%2B%2F%3D";
    searchParams.current = new URLSearchParams(oauthQuery);
    renderWithEmail("ada@example.com");

    await submit();

    expect(requestPasswordReset).toHaveBeenCalledWith(
      expect.objectContaining({
        redirectTo: `${window.location.origin}/reset-password/exchange?${oauthQuery}`,
      }),
    );
  });

  it("offers Log in in the links row, keeping the page context and the typed address", async () => {
    searchParams.current = new URLSearchParams("returnUrl=/chat");
    render(<ForgotPasswordForm />);
    await userEvent
      .setup()
      .type(screen.getByTestId("auth-field-email"), "ada@example.com");

    expect(screen.getByText("remembered", { exact: false })).toContainElement(
      screen.getByRole("link", { name: "logIn" }),
    );
    const logIn = screen.getByRole("link", { name: "logIn" });
    expect(logIn).toHaveAttribute("href", "/signin?returnUrl=%2Fchat");
    fireEvent.click(logIn);
    expect(takeAuthEmailHint()).toBe("ada@example.com");
  });

  it("says the address the link went to on a Check your email step, without redirecting", async () => {
    renderWithEmail("person@example.com");

    await submit();

    expect(sentHeading()).toBeInTheDocument();
    expect(screen.getByText("Sent.subtitle")).toBeInTheDocument();
    expect(screen.getByTestId("auth-email-chip")).toHaveTextContent(
      "person@example.com",
    );
    expect(screen.getByText("Sent.expiry")).toBeInTheDocument();
    expect(screen.queryByTestId("auth-field-email")).not.toBeInTheDocument();
    expect(requestPasswordReset).toHaveBeenCalledOnce();
    expect(push).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("explains that the reset link it came from is dead until a new one is sent", async () => {
    rememberAuthEmailHint("person@example.com");
    render(<ForgotPasswordForm linkExpired />);
    expect(screen.getByText("linkExpired")).toBeInTheDocument();

    await submit();
    expect(sentHeading()).toBeInTheDocument();
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: /person@example.com/ }));

    // Back to change the address: a new link is out, so the notice stays gone.
    expect(screen.getByTestId("auth-field-email")).toBeInTheDocument();
    expect(screen.queryByText("linkExpired")).not.toBeInTheDocument();
  });

  it("goes back from the chip with the address kept and focused", async () => {
    renderWithEmail("person@example.com");
    await submit();

    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: /person@example.com/ }));

    const email = screen.getByTestId("auth-field-email");
    expect(email).toHaveValue("person@example.com");
    expect(email).toHaveFocus();
  });

  it("sends the link again only after 30 seconds, to the same address", async () => {
    renderWithEmail("person@example.com");
    await submit();

    expect(
      screen.getByRole("button", { name: "Sent.resendIn 30" }),
    ).toBeDisabled();
    // The countdown reads the clock each second.
    const sentAt = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(sentAt + 31_000);
    const resend = await screen.findByRole(
      "button",
      { name: "Sent.resend" },
      { timeout: 2_500 },
    );
    vi.mocked(Date.now).mockRestore();

    await userEvent.setup().click(resend);

    await waitFor(() => expect(requestPasswordReset).toHaveBeenCalledTimes(2));
    expect(requestPasswordReset).toHaveBeenLastCalledWith(
      expect.objectContaining({ email: "person@example.com" }),
    );
    expect(sentHeading()).toBeInTheDocument();
  });

  it("goes back to Log in from Check your email, keeping the page context and the address", async () => {
    searchParams.current = new URLSearchParams("returnUrl=/chat");
    renderWithEmail("person@example.com");
    await submit();

    const back = screen.getByRole("link", { name: "Sent.backToLogIn" });
    expect(back).toHaveAttribute("href", "/signin?returnUrl=%2Fchat");
    fireEvent.click(back);
    expect(takeAuthEmailHint()).toBe("person@example.com");
  });

  it("says why a failed security check sent nothing", async () => {
    captchaErrorMessageMock.mockReturnValue("verificationFailed");
    vi.mocked(requestPasswordReset).mockResolvedValue({
      data: null,
      error: {
        status: 403,
        statusText: "Forbidden",
        code: "VERIFICATION_FAILED",
      },
    });
    renderWithEmail("person@example.com");

    await submit();

    expect(errorLine()).toHaveTextContent("verificationFailed");
    expect(screen.getByTestId("auth-field-email")).toHaveAccessibleDescription(
      "verificationFailed",
    );
    expect(sentHeading()).not.toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });

  it("asks a rate-limited person to wait", async () => {
    vi.mocked(requestPasswordReset).mockResolvedValue({
      data: null,
      error: { status: 429, statusText: "Too Many Requests" },
    });
    renderWithEmail("person@example.com");

    await submit();

    expect(errorLine()).toHaveTextContent("Errors.rateLimited");
  });

  it("explains an invalid address in the same line", async () => {
    render(<ForgotPasswordForm />);
    await userEvent
      .setup()
      .type(screen.getByTestId("auth-field-email"), "not-an-address");

    await submit();

    expect(errorLine()).not.toBeEmptyDOMElement();
    expect(screen.getByTestId("auth-field-email")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    expect(requestPasswordReset).not.toHaveBeenCalled();
  });

  it("reports a rejected request and allows retry", async () => {
    vi.mocked(requestPasswordReset).mockRejectedValueOnce(
      new Error("Network unavailable"),
    );
    renderWithEmail("person@example.com");

    await submit();

    expect(errorLine()).toHaveTextContent("Errors.generic");
    expect(sentHeading()).not.toBeInTheDocument();
    await submit();
    expect(sentHeading()).toBeInTheDocument();
    expect(screen.queryByText("Errors.generic")).not.toBeInTheDocument();
  });

  it("does not report success when CAPTCHA blocks the request", async () => {
    requestCaptchaMock.mockResolvedValueOnce(null);
    renderWithEmail("person@example.com");

    await submit();

    expect(requestPasswordReset).not.toHaveBeenCalled();
    expect(sentHeading()).not.toBeInTheDocument();
  });

  it("says a failed second send in the status line, keeping Check your email", async () => {
    renderWithEmail("person@example.com");
    await submit();
    vi.mocked(requestPasswordReset).mockResolvedValueOnce({
      data: null,
      error: { status: 429, statusText: "Too Many Requests" },
    });
    const sentAt = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(sentAt + 31_000);
    const resend = await screen.findByRole(
      "button",
      { name: "Sent.resend" },
      { timeout: 2_500 },
    );
    vi.mocked(Date.now).mockRestore();

    await userEvent.setup().click(resend);

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        "Errors.rateLimited",
      ),
    );
    expect(sentHeading()).toBeInTheDocument();
  });
});
