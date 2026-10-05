import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { requestPasswordReset } from "@/lib/auth/auth.client";
import { rememberAuthEmailHint } from "@/lib/auth/auth-email-hint";
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
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@/lib/auth/auth.client", () => ({ requestPasswordReset: vi.fn() }));
vi.mock("@/components/auth-captcha", () => import("@/test/auth-captcha-mock"));

async function submit() {
  await userEvent
    .setup()
    .click(screen.getByRole("button", { name: "reset_password" }));
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "reset_password" }),
    ).toBeEnabled(),
  );
}

function renderWithEmail(email: string) {
  rememberAuthEmailHint(email);
  render(<ForgotPasswordForm />);
}

describe("SOK-1144 password reset feedback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.sessionStorage.clear();
    searchParams.current = new URLSearchParams();
    vi.mocked(requestPasswordReset).mockResolvedValue({
      data: { status: true },
      error: null,
    });
  });

  it("names the address inside its field, with an email keyboard and no autocorrect", () => {
    render(<ForgotPasswordForm />);

    // The label stays for screen readers; the placeholder shows the name.
    const email = screen.getByLabelText("Fields.Email.label");
    expect(email).toBe(screen.getByTestId("auth-field-email"));
    expect(email).toHaveAttribute("placeholder", "Fields.Email.label");
    expect(
      screen.getByText("Fields.Email.label", { selector: "label" }),
    ).toHaveClass("sr-only");
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

  it("explains that the reset link it came from is dead until a new one is sent", async () => {
    rememberAuthEmailHint("person@example.com");
    render(<ForgotPasswordForm linkExpired />);
    expect(screen.getByText("linkExpired")).toBeInTheDocument();

    await submit();

    expect(screen.getByRole("status")).toHaveTextContent("success");
    expect(screen.queryByText("linkExpired")).not.toBeInTheDocument();
  });

  it("keeps success visible on the form without redirecting", async () => {
    renderWithEmail("person@example.com");
    expect(screen.getByRole("status")).toBeEmptyDOMElement();

    await submit();

    expect(screen.getByRole("status")).toHaveTextContent("success");
    expect(requestPasswordReset).toHaveBeenCalledOnce();
    expect(push).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
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

    expect(screen.getByRole("alert")).toHaveTextContent("verificationFailed");
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
    expect(push).not.toHaveBeenCalled();
  });

  it("reports a rejected request and allows retry", async () => {
    vi.mocked(requestPasswordReset).mockRejectedValueOnce(
      new Error("Network unavailable"),
    );
    renderWithEmail("person@example.com");

    await submit();

    expect(screen.getByRole("alert")).toHaveTextContent("Errors.generic");
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
    await submit();
    expect(screen.getByRole("status")).toHaveTextContent("success");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("does not report success when CAPTCHA blocks the request", async () => {
    requestCaptchaMock.mockResolvedValueOnce(null);
    renderWithEmail("person@example.com");

    await submit();

    expect(requestPasswordReset).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });

  it("clears the previous success when a new request fails", async () => {
    renderWithEmail("person@example.com");
    await submit();
    expect(screen.getByRole("status")).toHaveTextContent("success");
    vi.mocked(requestPasswordReset).mockRejectedValueOnce(
      new Error("Network unavailable"),
    );

    await submit();

    expect(screen.getByRole("status")).toBeEmptyDOMElement();
    expect(screen.getByRole("alert")).toHaveTextContent("Errors.generic");
  });
});
