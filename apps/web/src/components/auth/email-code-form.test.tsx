import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { EmailCodeForm } from "./email-code-form";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: { email?: string }) =>
    values?.email ? `${key} ${values.email}` : key,
}));

function renderForm(
  overrides: Partial<Parameters<typeof EmailCodeForm>[0]> = {},
) {
  const props = {
    email: "ada@example.com",
    submitLabel: "Sign in",
    onSubmitCode: vi.fn().mockResolvedValue(undefined),
    onResend: vi.fn(),
    isResending: false,
    // Long enough ago that a new code may be asked for.
    sentAt: 0,
    ...overrides,
  };
  render(<EmailCodeForm {...props} />);
  return props;
}

describe("EmailCodeForm", () => {
  it("says where the code went and asks for it with the one-time-code keyboard", () => {
    renderForm();

    const code = screen.getByRole("textbox", { name: "codeLabel" });
    // Focus lands on the field, so its description is what gets read out.
    expect(code).toHaveFocus();
    expect(code).toHaveAccessibleDescription("sent ada@example.com");
    expect(code).toHaveAttribute("autocomplete", "one-time-code");
    expect(code).toHaveAttribute("inputmode", "numeric");
  });

  it("submits a pasted code without its spaces", async () => {
    const user = userEvent.setup();
    const { onSubmitCode } = renderForm();

    await user.click(screen.getByRole("textbox", { name: "codeLabel" }));
    await user.paste("042 917");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(onSubmitCode).toHaveBeenCalledWith("042917");
  });

  it("asks for all six digits before sending anything", async () => {
    const user = userEvent.setup();
    const { onSubmitCode } = renderForm();

    await user.type(screen.getByRole("textbox", { name: "codeLabel" }), "0429");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(onSubmitCode).not.toHaveBeenCalled();
    expect(screen.getByRole("textbox", { name: "codeLabel" })).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    expect(
      screen.getByRole("textbox", { name: "codeLabel" }),
    ).toHaveAccessibleDescription(/incomplete/);
  });

  it.each([
    ["INVALID_OTP", "invalid"],
    ["OTP_EXPIRED", "expired"],
    ["TOO_MANY_ATTEMPTS", "tooManyAttempts"],
    ["TERMS_NOT_ACCEPTED", "termsNotAccepted"],
    // Better Auth's own message is English; the page says it in its language.
    ["SOMETHING_ELSE", "generic"],
  ])("explains a %s answer beside the field", async (code, message) => {
    const user = userEvent.setup();
    renderForm({
      onSubmitCode: vi.fn().mockResolvedValue({ code, message: "raw" }),
    });

    await user.type(
      screen.getByRole("textbox", { name: "codeLabel" }),
      "042917",
    );
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    const field = screen.getByRole("textbox", { name: "codeLabel" });
    await waitFor(() => expect(field).toHaveAttribute("aria-invalid", "true"));
    expect(field).toHaveAccessibleDescription(new RegExp(`${message}$`));
    // Submitting left focus on the button; it returns to what needs fixing.
    expect(field).toHaveFocus();
    expect(screen.getByRole("button", { name: "Sign in" })).toBeEnabled();
  });

  it("asks to wait when Core's rate limit answers before the tries run out", async () => {
    const user = userEvent.setup();
    renderForm({
      onSubmitCode: vi
        .fn()
        .mockResolvedValue({ status: 429, message: "Too many requests" }),
    });

    await user.type(
      screen.getByRole("textbox", { name: "codeLabel" }),
      "042917",
    );
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() =>
      expect(
        screen.getByRole("textbox", { name: "codeLabel" }),
      ).toHaveAccessibleDescription(/rateLimited$/),
    );
  });

  it("shows nothing and unlocks when the page declines to send the code", async () => {
    const user = userEvent.setup();
    renderForm({ onSubmitCode: vi.fn().mockResolvedValue(false) });

    await user.type(
      screen.getByRole("textbox", { name: "codeLabel" }),
      "042917",
    );
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Sign in" })).toBeEnabled(),
    );
    expect(
      screen.getByRole("textbox", { name: "codeLabel" }),
    ).not.toHaveAttribute("aria-invalid");
  });

  it("stays locked once the code is accepted, while the page moves on", async () => {
    const user = userEvent.setup();
    renderForm();

    await user.type(
      screen.getByRole("textbox", { name: "codeLabel" }),
      "042917",
    );
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Sign in" })).toBeDisabled(),
    );
  });

  it("leaves the address out when the page already shows it", () => {
    renderForm({ email: undefined });

    expect(
      screen.getByRole("textbox", { name: "codeLabel" }),
    ).toHaveAccessibleDescription("sentNoAddress");
  });

  it("offers a new code beside the field only after the wait", () => {
    renderForm({ sentAt: Date.now() });

    expect(screen.getByRole("button", { name: /^resendIn/ })).toBeDisabled();
  });

  it("sends a new code on request", async () => {
    const user = userEvent.setup();
    const { onResend } = renderForm();

    await user.click(screen.getByRole("button", { name: "resend" }));

    expect(onResend).toHaveBeenCalledOnce();
  });
});
