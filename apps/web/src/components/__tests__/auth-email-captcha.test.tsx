import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { EmailForm } from "@/app/account/components/email-form";
import ForgotPasswordForm from "@/auth/forgot-password/components/form";

const requestCaptcha = vi.fn();
const changeEmail = vi.fn();
const requestPasswordReset = vi.fn();

vi.mock("@/components/auth-captcha-provider", () => ({
  useAuthCaptcha: () => requestCaptcha,
}));
vi.mock("@/lib/auth/auth.client", () => ({
  changeEmail: (...args: unknown[]) => changeEmail(...args),
  requestPasswordReset: (...args: unknown[]) => requestPasswordReset(...args),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

beforeEach(() => {
  vi.clearAllMocks();
  requestCaptcha.mockResolvedValue({
    headers: { "x-captcha-response": "token" },
  });
  changeEmail.mockResolvedValue({ data: {}, error: null });
  requestPasswordReset.mockResolvedValue({ data: {}, error: null });
});

describe.each([
  {
    name: "password reset",
    Component: ForgotPasswordForm,
    placeholder: "Fields.Email.placeholder",
    submit: "reset_password",
    send: requestPasswordReset,
  },
  {
    name: "email change",
    Component: EmailForm,
    placeholder: "mail@sokosumi.com",
    submit: "submit",
    send: changeEmail,
  },
])("$name captcha", ({ Component, placeholder, submit, send }) => {
  it.each([true, false])(
    "sends only after a completed check (verified=%s)",
    async (verified) => {
      if (!verified) requestCaptcha.mockResolvedValueOnce(null);
      render(<Component />);
      const user = userEvent.setup();
      await user.type(
        screen.getByPlaceholderText(placeholder),
        "person@example.com",
      );
      await user.click(screen.getByRole("button", { name: submit }));
      expect(requestCaptcha).toHaveBeenCalledOnce();
      if (verified) {
        expect(send).toHaveBeenCalledWith(
          expect.objectContaining({
            fetchOptions: { headers: { "x-captcha-response": "token" } },
          }),
        );
      } else {
        expect(send).not.toHaveBeenCalled();
      }
    },
  );
});
