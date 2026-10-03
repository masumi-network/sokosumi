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

function codeField() {
  return screen.getByRole("textbox", { name: "codeLabel" });
}

function statusLine() {
  return screen.getByRole("status");
}

describe("EmailCodeForm", () => {
  it("says where the code went and asks for it with the one-time-code keyboard, with no visible label", () => {
    renderForm();

    const code = codeField();
    // Focus lands on the field, so its description is what gets read out.
    expect(code).toHaveFocus();
    expect(code).toHaveAccessibleDescription("sent ada@example.com");
    expect(code).toHaveAttribute("autocomplete", "one-time-code");
    expect(code).toHaveAttribute("inputmode", "numeric");
    expect(screen.queryByText("codeLabel")).toBeNull();
  });

  it("has no button to send the code: the sixth digit sends it", async () => {
    const user = userEvent.setup();
    const { onSubmitCode } = renderForm();

    expect(screen.getAllByRole("button")).toHaveLength(1);
    await user.type(codeField(), "042917");

    expect(onSubmitCode).toHaveBeenCalledExactlyOnceWith("042917");
  });

  it("sends a pasted code without its spaces", async () => {
    const user = userEvent.setup();
    const { onSubmitCode } = renderForm();

    await user.click(codeField());
    await user.paste("042 917");

    expect(onSubmitCode).toHaveBeenCalledExactlyOnceWith("042917");
  });

  it("says the code is being checked, and locks automatic and manual submissions before React renders pending", async () => {
    const { onSubmitCode } = renderForm({
      onSubmitCode: vi.fn(() => new Promise<undefined>(() => {})),
    });
    const code = codeField();
    const formElement = code.closest("form");
    if (!formElement) throw new Error("Missing code form");
    act(() => {
      fireEvent.change(code, { target: { value: "042917" } });
      fireEvent.submit(formElement);
      fireEvent.submit(formElement);
    });
    expect(onSubmitCode).toHaveBeenCalledExactlyOnceWith("042917");
    expect(code).toBeDisabled();
    expect(statusLine()).toHaveTextContent("checking");
    fireEvent.submit(formElement);
    expect(onSubmitCode).toHaveBeenCalledOnce();
    await act(async () => {});
  });

  it("asks for all six digits when Enter comes early", async () => {
    const user = userEvent.setup();
    const { onSubmitCode } = renderForm();

    await user.type(codeField(), "0429{Enter}");

    expect(onSubmitCode).not.toHaveBeenCalled();
    // Not refused, only short: the digits stay.
    expect(codeField()).toHaveValue("0429");
    expect(codeField()).toHaveAttribute("aria-invalid", "true");
    expect(codeField()).toHaveAccessibleDescription(/incomplete/);
  });

  it.each([
    ["INVALID_OTP", "invalid"],
    ["OTP_EXPIRED", "expired"],
    ["TOO_MANY_ATTEMPTS", "tooManyAttempts"],
    ["TERMS_NOT_ACCEPTED", "termsNotAccepted"],
    // Better Auth's own message is English; the page says it in its language.
    ["SOMETHING_ELSE", "generic"],
  ])("explains a %s answer under the field", async (code, message) => {
    const user = userEvent.setup();
    renderForm({
      onSubmitCode: vi.fn().mockResolvedValue({ code, message: "raw" }),
    });

    await user.type(codeField(), "042917");

    const field = codeField();
    await waitFor(() => expect(field).toHaveAttribute("aria-invalid", "true"));
    expect(field).toHaveAccessibleDescription(new RegExp(`${message}$`));
    expect(statusLine()).toHaveTextContent(message);
    // The field takes six digits; the refused ones would block the next code.
    expect(field).toHaveValue("");
    // Checking the code disabled the field; focus returns to it.
    await waitFor(() => expect(field).toHaveFocus());
  });

  it("keeps a refused code's reason until the next one is typed, and takes the same code again", async () => {
    const user = userEvent.setup();
    const { onSubmitCode } = renderForm({
      onSubmitCode: vi.fn().mockResolvedValue({ code: "INVALID_OTP" }),
    });
    const field = codeField();

    await user.type(field, "042917");
    await waitFor(() => expect(field).toHaveAccessibleDescription(/invalid$/));
    await waitFor(() => expect(field).toHaveFocus());

    await user.type(field, "0");
    expect(field).not.toHaveAttribute("aria-invalid");
    expect(field).toHaveAccessibleDescription("sent ada@example.com");
    expect(statusLine()).toBeEmptyDOMElement();

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

    await user.type(codeField(), "042917");

    await waitFor(() =>
      expect(codeField()).toHaveAccessibleDescription(/rateLimited$/),
    );
    expect(codeField()).toHaveValue("");
  });

  it("clears the field when the check fails without an answer, so the same code can be typed again", async () => {
    const user = userEvent.setup();
    const { onSubmitCode } = renderForm({
      onSubmitCode: vi
        .fn()
        .mockRejectedValueOnce(new TypeError("Failed to fetch"))
        .mockResolvedValue(undefined),
    });
    const field = codeField();

    await user.type(field, "042917");

    await waitFor(() => expect(field).toHaveAccessibleDescription(/generic$/));
    expect(field).toHaveValue("");
    await waitFor(() => expect(field).toHaveFocus());

    await user.type(field, "042917");
    await waitFor(() => expect(onSubmitCode).toHaveBeenCalledTimes(2));
    expect(onSubmitCode).toHaveBeenLastCalledWith("042917");
  });

  it("stays locked once the code is accepted, while the page moves on", async () => {
    const user = userEvent.setup();
    renderForm();

    await user.type(codeField(), "042917");

    await waitFor(() => expect(codeField()).toBeDisabled());
    expect(screen.getByRole("button", { name: "resend" })).toBeDisabled();
  });

  it("leaves the address out when the page already shows it", () => {
    renderForm({ email: undefined });

    expect(codeField()).toHaveAccessibleDescription("sentNoAddress");
  });

  it("offers a new code under the field only after the wait", () => {
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
