import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { EmailForm } from "./email-form";

const changeEmailMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, string>) =>
    values ? `${key} ${JSON.stringify(values)}` : key,
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

vi.mock("@/components/auth-captcha", () => ({
  useAuthCaptcha: () => ({
    widget: null,
    runWithCaptcha: (run: (options: object) => Promise<void>) => run({}),
    getErrorMessage: (_error: unknown, fallback: string) => fallback,
  }),
}));

vi.mock("@/lib/auth/auth.client", () => ({
  changeEmail: (...args: unknown[]) => changeEmailMock(...args),
}));

describe("EmailForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    changeEmailMock.mockResolvedValue({ data: { status: true }, error: null });
  });

  it("names the address the account uses today", () => {
    render(<EmailForm currentEmail="ada@example.com" />);

    expect(
      screen.getByText('descriptionWithCurrent {"email":"ada@example.com"}'),
    ).toBeInTheDocument();
  });

  it("tells the reader to confirm from the new inbox instead of claiming the change is done", async () => {
    const user = userEvent.setup();
    render(<EmailForm currentEmail="ada@example.com" />);

    await user.type(screen.getByRole("textbox"), "ada@new.example");
    await user.click(screen.getByRole("button", { name: "submit" }));

    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith(
        'success {"email":"ada@new.example"}',
      );
    });
  });
});
