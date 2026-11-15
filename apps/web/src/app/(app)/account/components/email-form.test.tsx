import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { EmailForm } from "./email-form";

const changeEmailMock = vi.fn();
const fetchMock = vi.fn();
const replaceMock = vi.fn();
let searchParams = new URLSearchParams();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), replace: replaceMock }),
  usePathname: () => "/account",
  useSearchParams: () => searchParams,
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
  authClient: { $fetch: (...args: unknown[]) => fetchMock(...args) },
}));

describe("EmailForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    searchParams = new URLSearchParams();
    fetchMock.mockResolvedValue({ data: { status: true }, error: null });
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

  it("keeps a waiting change visible and sends its link again", async () => {
    const user = userEvent.setup();
    render(
      <EmailForm
        currentEmail="ada@example.com"
        pendingEmail="ada@new.example"
      />,
    );

    expect(screen.getByText("ada@new.example")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "resend" }));

    await waitFor(() => {
      expect(changeEmailMock).toHaveBeenCalledWith(
        expect.objectContaining({ newEmail: "ada@new.example" }),
      );
    });
  });

  it("cancels the waiting change in Core, not only on screen", async () => {
    const user = userEvent.setup();
    render(
      <EmailForm
        currentEmail="ada@example.com"
        pendingEmail="ada@new.example"
      />,
    );

    await user.click(screen.getByRole("button", { name: "cancel" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/change-email/cancel", {
        method: "POST",
      });
      expect(toast.success).toHaveBeenCalledWith("cancelled");
    });
  });

  it("names the new address after the link, from the account itself", () => {
    searchParams = new URLSearchParams("emailChange=1");
    render(<EmailForm currentEmail="ada@new.example" pendingEmail={null} />);

    expect(toast.success).toHaveBeenCalledWith(
      'changed {"email":"ada@new.example"}',
    );
    expect(replaceMock).toHaveBeenCalledWith("/account");
  });

  it("says the link failed when Better Auth refused it", () => {
    searchParams = new URLSearchParams("emailChange=1&error=INVALID_TOKEN");
    render(<EmailForm currentEmail="ada@example.com" pendingEmail={null} />);

    expect(toast.error).toHaveBeenCalledWith("linkFailed");
    expect(toast.success).not.toHaveBeenCalled();
  });
});
