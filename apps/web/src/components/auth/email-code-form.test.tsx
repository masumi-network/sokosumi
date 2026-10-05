import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
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
    submitLabel: "Log in",
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
    await user.click(screen.getByRole("button", { name: "Log in" }));

    expect(onSubmitCode).toHaveBeenCalledWith("042917");
  });

  it("submits as soon as the sixth digit is typed", async () => {
    const user = userEvent.setup();
    const { onSubmitCode } = renderForm();

    await user.type(
      screen.getByRole("textbox", { name: "codeLabel" }),
      "042917",
    );

    expect(onSubmitCode).toHaveBeenCalledExactlyOnceWith("042917");
  });

  it("locks automatic and manual submissions before React renders pending", async () => {
    const { onSubmitCode } = renderForm({
      onSubmitCode: vi.fn(() => new Promise<undefined>(() => {})),
    });
    const code = screen.getByRole("textbox", { name: "codeLabel" });
    const formElement = code.closest("form");
    if (!formElement) throw new Error("Missing code form");
    act(() => {
      fireEvent.change(code, { target: { value: "042917" } });
      fireEvent.submit(formElement);
      fireEvent.submit(formElement);
    });
    expect(onSubmitCode).toHaveBeenCalledExactlyOnceWith("042917");
    expect(code).toBeDisabled();
    fireEvent.submit(formElement);
    expect(onSubmitCode).toHaveBeenCalledOnce();
    await act(async () => {});
  });

  it("asks for all six digits before sending anything", async () => {
    const user = userEvent.setup();
    const { onSubmitCode } = renderForm();

    await user.type(screen.getByRole("textbox", { name: "codeLabel" }), "0429");
    await user.click(screen.getByRole("button", { name: "Log in" }));

    expect(onSubmitCode).not.toHaveBeenCalled();
    // Not refused, only short: the digits stay.
    expect(screen.getByRole("textbox", { name: "codeLabel" })).toHaveValue(
      "0429",
    );
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

    const field = screen.getByRole("textbox", { name: "codeLabel" });
    await waitFor(() => expect(field).toHaveAttribute("aria-invalid", "true"));
    expect(field).toHaveAccessibleDescription(new RegExp(`${message}$`));
    // The field takes six digits; the refused ones would block the next code.
    expect(field).toHaveValue("");
    // Checking the code disabled the field; focus returns to it.
    await waitFor(() => expect(field).toHaveFocus());
    expect(screen.getByRole("button", { name: "Log in" })).toBeEnabled();
  });

  it("keeps a refused code's reason until the next one is typed, and takes the same code again", async () => {
    const user = userEvent.setup();
    const { onSubmitCode } = renderForm({
      onSubmitCode: vi.fn().mockResolvedValue({ code: "INVALID_OTP" }),
    });
    const field = screen.getByRole("textbox", { name: "codeLabel" });

    await user.type(field, "042917");
    await waitFor(() => expect(field).toHaveAccessibleDescription(/invalid$/));
    await waitFor(() => expect(field).toHaveFocus());

    await user.type(field, "0");
    expect(field).not.toHaveAttribute("aria-invalid");
    expect(field).toHaveAccessibleDescription("sent ada@example.com");

    await user.type(field, "42917");
    await waitFor(() => expect(onSubmitCode).toHaveBeenCalledTimes(2));
    expect(onSubmitCode).toHaveBeenLastCalledWith("042917");
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

    await waitFor(() =>
      expect(
        screen.getByRole("textbox", { name: "codeLabel" }),
      ).toHaveAccessibleDescription(/rateLimited$/),
    );
    expect(screen.getByRole("textbox", { name: "codeLabel" })).toHaveValue("");
  });

  it("keeps the digits when the check fails without an answer, so the button can send them again", async () => {
    const user = userEvent.setup();
    const { onSubmitCode } = renderForm({
      onSubmitCode: vi.fn().mockRejectedValue(new TypeError("Failed to fetch")),
    });
    const field = screen.getByRole("textbox", { name: "codeLabel" });

    await user.type(field, "042917");

    await waitFor(() => expect(field).toHaveAccessibleDescription(/generic$/));
    // Nothing refused the code; it was never checked.
    expect(field).toHaveValue("042917");
    expect(field).toHaveFocus();

    await user.click(screen.getByRole("button", { name: "Log in" }));
    await waitFor(() => expect(onSubmitCode).toHaveBeenCalledTimes(2));
    expect(onSubmitCode).toHaveBeenLastCalledWith("042917");
  });

  it("shows nothing and unlocks when the page declines to send the code", async () => {
    const user = userEvent.setup();
    renderForm({ onSubmitCode: vi.fn().mockResolvedValue(false) });

    await user.type(
      screen.getByRole("textbox", { name: "codeLabel" }),
      "042917",
    );
    await user.click(screen.getByRole("button", { name: "Log in" }));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Log in" })).toBeEnabled(),
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
    await user.click(screen.getByRole("button", { name: "Log in" }));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Log in" })).toHaveAttribute(
        "aria-busy",
        "true",
      ),
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
