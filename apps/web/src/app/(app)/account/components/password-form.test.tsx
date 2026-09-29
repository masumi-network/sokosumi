import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PasswordForm } from "./password-form";

const changePasswordMock = vi.fn();

const translations: Record<string, string> = {
  "App.Account.Password.title": "Change password",
  "App.Account.Password.description": "Update your password",
  "App.Account.Password.currentPassword": "Current password",
  "App.Account.Password.newPassword": "New password",
  "App.Account.Password.confirmPassword": "Confirm new password",
  "App.Account.Password.revokeOtherSessionsLabel": "Sign out of other devices",
  "App.Account.Password.revokeOtherSessionsHelp":
    "Ends every other session. The device you are using now stays signed in.",
  "App.Account.Password.submit": "Update password",
  "App.Account.Password.success": "Password updated successfully",
  "App.Account.Password.error": "Failed to update password",
};

vi.mock("next-intl", () => ({
  useTranslations: (namespace?: string) => (key: string) =>
    translations[namespace ? `${namespace}.${key}` : key] ??
    (namespace ? `${namespace}.${key}` : key),
}));

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

vi.mock("@/lib/auth/auth.client", () => ({
  changePassword: (...args: unknown[]) => changePasswordMock(...args),
}));

async function submitValidForm() {
  const user = userEvent.setup();

  await user.type(screen.getByLabelText("Current password"), "OldPassword1!");
  await user.type(screen.getByLabelText("New password"), "NewPassword1!");
  await user.type(
    screen.getByLabelText("Confirm new password"),
    "NewPassword1!",
  );

  return user;
}

describe("PasswordForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    changePasswordMock.mockResolvedValue({ data: {}, error: null });
  });

  it("ticks the sign-out checkbox by default and revokes other sessions", async () => {
    render(<PasswordForm />);

    const checkbox = screen.getByRole("checkbox", {
      name: "Sign out of other devices",
    });
    expect(checkbox).toBeChecked();

    const user = await submitValidForm();
    await user.click(screen.getByRole("button", { name: "Update password" }));

    await waitFor(() => {
      expect(changePasswordMock).toHaveBeenCalledWith({
        currentPassword: "OldPassword1!",
        newPassword: "NewPassword1!",
        revokeOtherSessions: true,
      });
    });
  });

  it("keeps other sessions alive when the reader unticks the checkbox", async () => {
    render(<PasswordForm />);

    const user = await submitValidForm();
    await user.click(
      screen.getByRole("checkbox", { name: "Sign out of other devices" }),
    );
    await user.click(screen.getByRole("button", { name: "Update password" }));

    await waitFor(() => {
      expect(changePasswordMock).toHaveBeenCalledWith({
        currentPassword: "OldPassword1!",
        newPassword: "NewPassword1!",
        revokeOtherSessions: false,
      });
    });
  });
});
