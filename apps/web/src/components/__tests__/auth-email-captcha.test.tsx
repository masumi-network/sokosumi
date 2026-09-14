import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EmailForm } from "@/app/account/components/email-form";
import ForgotPasswordForm from "@/auth/forgot-password/components/form";
import {
  captchaErrorMessageMock,
  captchaFetchOptions,
  requestCaptchaMock,
} from "@/test/auth-captcha-mock";

const changeEmail = vi.fn();
const requestPasswordReset = vi.fn();

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
    errorFallback: "error",
  },
  {
    name: "email change",
    Component: EmailForm,
    placeholder: "mail@sokosumi.com",
    submit: "submit",
    send: changeEmail,
    errorFallback: "Captcha verification failed",
  },
])(
  "$name captcha",
  ({ Component, placeholder, submit, send, errorFallback }) => {
    it("shows the translated captcha error without reporting success", async () => {
      const error = {
        code: "VERIFICATION_FAILED",
        message: "Captcha verification failed",
      };
      send.mockResolvedValueOnce({ data: null, error });
      captchaErrorMessageMock.mockReturnValue("Translated captcha error");
      const user = userEvent.setup();
      render(<Component />);
      await user.type(
        screen.getByPlaceholderText(placeholder),
        "person@example.com",
      );
      await user.click(screen.getByRole("button", { name: submit }));

      expect(captchaErrorMessageMock).toHaveBeenCalledWith(
        error,
        errorFallback,
      );
      expect(toast.error).toHaveBeenLastCalledWith("Translated captcha error");
      expect(toast.success).not.toHaveBeenCalled();
    });

    it.each([true, false])(
      "sends only after a completed check (verified=%s)",
      async (verified) => {
        if (!verified) requestCaptchaMock.mockResolvedValueOnce(null);
        render(<Component />);
        const user = userEvent.setup();
        await user.type(
          screen.getByPlaceholderText(placeholder),
          "person@example.com",
        );
        await user.click(screen.getByRole("button", { name: submit }));
        expect(requestCaptchaMock).toHaveBeenCalledOnce();
        if (verified) {
          expect(send).toHaveBeenCalledWith(
            expect.objectContaining({
              fetchOptions: captchaFetchOptions,
            }),
          );
        } else {
          expect(send).not.toHaveBeenCalled();
        }
      },
    );
  },
);

vi.mock(
  "@/components/auth-captcha-provider",
  () => import("@/test/auth-captcha-mock"),
);
