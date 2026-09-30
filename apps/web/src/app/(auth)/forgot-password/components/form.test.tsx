import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { requestPasswordReset } from "@/lib/auth/auth.client";
import { requestCaptchaMock } from "@/test/auth-captcha-mock";

import ForgotPasswordForm from "./form";

const { push } = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
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

describe("SOK-1144 password reset feedback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requestPasswordReset).mockResolvedValue({
      data: { status: true },
      error: null,
    });
  });

  it("asks for the address with an email keyboard and no autocorrect", () => {
    render(<ForgotPasswordForm />);

    const email = screen.getByTestId("auth-field-email");
    expect(email).toHaveAttribute("type", "email");
    expect(email).toHaveAttribute("autocomplete", "email");
    expect(email).toHaveAttribute("autocapitalize", "none");
    expect(email).toHaveAttribute("spellcheck", "false");
  });

  // The browser strips the space from what is typed into an email input, but
  // not from an address handed over from sign-in.
  it("sends a handed-over address without its trailing space", async () => {
    render(<ForgotPasswordForm initialEmail="ada@example.com " />);

    await submit();

    expect(requestPasswordReset).toHaveBeenCalledWith(
      expect.objectContaining({ email: "ada@example.com" }),
    );
  });

  it("keeps success visible on the form without redirecting", async () => {
    render(<ForgotPasswordForm initialEmail="person@example.com" />);
    expect(screen.getByRole("status")).toBeEmptyDOMElement();

    await submit();

    expect(screen.getByRole("status")).toHaveTextContent("success");
    expect(requestPasswordReset).toHaveBeenCalledOnce();
    expect(push).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("keeps an API failure silent without reporting success", async () => {
    vi.mocked(requestPasswordReset).mockResolvedValue({
      data: null,
      error: {
        status: 400,
        statusText: "Bad Request",
        message: "Reset failed",
      },
    });
    render(<ForgotPasswordForm initialEmail="person@example.com" />);

    await submit();

    expect(requestPasswordReset).toHaveBeenCalledOnce();
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
    expect(toast.error).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });

  it("handles a rejected request silently and allows retry", async () => {
    vi.mocked(requestPasswordReset).mockRejectedValueOnce(
      new Error("Network unavailable"),
    );
    render(<ForgotPasswordForm initialEmail="person@example.com" />);

    await submit();

    expect(screen.getByRole("status")).toBeEmptyDOMElement();
    expect(toast.error).not.toHaveBeenCalled();
    await submit();
    expect(screen.getByRole("status")).toHaveTextContent("success");
  });

  it("does not report success when CAPTCHA blocks the request", async () => {
    requestCaptchaMock.mockResolvedValueOnce(null);
    render(<ForgotPasswordForm initialEmail="person@example.com" />);

    await submit();

    expect(requestPasswordReset).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });

  it("clears the previous success when a new request fails", async () => {
    render(<ForgotPasswordForm initialEmail="person@example.com" />);
    await submit();
    expect(screen.getByRole("status")).toHaveTextContent("success");
    vi.mocked(requestPasswordReset).mockRejectedValueOnce(
      new Error("Network unavailable"),
    );

    await submit();

    expect(screen.getByRole("status")).toBeEmptyDOMElement();
    expect(toast.error).not.toHaveBeenCalled();
  });
});
