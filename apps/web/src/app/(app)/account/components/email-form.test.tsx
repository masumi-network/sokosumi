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
  authClient: {
    $fetch: (path: string, options: { body?: object }) =>
      path === "/email-change/request"
        ? changeEmailMock(options.body)
        : fetchMock(path, options),
  },
}));

describe("EmailForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    searchParams = new URLSearchParams();
    fetchMock.mockResolvedValue({ data: { cancelled: true }, error: null });
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
        emailChange={{
          pending: { newEmail: "ada@new.example" },
          completed: null,
        }}
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
        emailChange={{
          pending: { newEmail: "ada@new.example" },
          completed: null,
        }}
      />,
    );

    await user.click(screen.getByRole("button", { name: "cancel" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/email-change/cancel", {
        method: "POST",
      });
      expect(toast.success).toHaveBeenCalledWith("cancelled");
    });
  });

  it("says there was nothing to cancel when a link already applied it", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue({ data: { cancelled: false }, error: null });
    render(
      <EmailForm
        currentEmail="ada@example.com"
        emailChange={{
          pending: { newEmail: "ada@new.example" },
          completed: null,
        }}
      />,
    );

    await user.click(screen.getByRole("button", { name: "cancel" }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("cancelTooLate");
    });
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("names the new address only when Core recorded the change", () => {
    searchParams = new URLSearchParams("emailChange=1");
    render(
      <EmailForm
        currentEmail="ada@new.example"
        emailChange={{
          pending: null,
          completed: { newEmail: "ada@new.example" },
        }}
      />,
    );

    expect(toast.success).toHaveBeenCalledWith(
      'changed {"email":"ada@new.example"}',
    );
    expect(fetchMock).toHaveBeenCalledWith("/email-change/acknowledge", {
      method: "POST",
    });
    expect(replaceMock).toHaveBeenCalledWith("/account");
  });

  it.each([
    ["a forged return flag", { pending: null, completed: null }],
    ["a cancelled or expired request", { pending: null, completed: null }],
    [
      "a change still waiting",
      { pending: { newEmail: "ada@new.example" }, completed: null },
    ],
    ["an unreadable status", null],
  ])("claims no success for %s", (_case, emailChange) => {
    searchParams = new URLSearchParams("emailChange=1");
    render(
      <EmailForm currentEmail="ada@example.com" emailChange={emailChange} />,
    );

    expect(toast.success).not.toHaveBeenCalled();
    expect(replaceMock).toHaveBeenCalledWith("/account");
  });

  it("says the link failed when Better Auth refused it", () => {
    searchParams = new URLSearchParams("emailChange=1&error=INVALID_TOKEN");
    render(
      <EmailForm
        currentEmail="ada@example.com"
        emailChange={{ pending: null, completed: null }}
      />,
    );

    expect(toast.error).toHaveBeenCalledWith("linkFailed");
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("tells the reader when the waiting change could not be read", () => {
    render(<EmailForm currentEmail="ada@example.com" emailChange={null} />);

    expect(screen.getByText("statusUnavailable")).toBeInTheDocument();
  });
});
