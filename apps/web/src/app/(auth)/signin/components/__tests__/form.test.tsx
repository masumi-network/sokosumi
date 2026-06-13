import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import SignInForm from "../form";

const mockReplace = vi.fn();
const mockSignInEmail = vi.fn();
const mockGetSession = vi.fn();
const mockWaitForAuthSession = vi.fn().mockResolvedValue(undefined);

let mockSearchParams = new URLSearchParams();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: mockReplace,
  }),
  useSearchParams: () => mockSearchParams as unknown as URLSearchParams,
}));

vi.mock("next-intl", () => ({
  useTranslations: () => {
    const translator = (key: string) => {
      if (key === "lastUsed") {
        return "last-used";
      }
      return key;
    };

    translator.has = (key: string) => key === "lastUsed";

    return translator;
  },
}));

vi.mock("@vercel/analytics", () => ({
  track: vi.fn(),
}));

vi.mock("@sentry/nextjs", () => ({
  captureMessage: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("@/lib/actions", () => ({
  AuthErrorCode: {
    TERMS_NOT_ACCEPTED: "TERMS_NOT_ACCEPTED",
  },
}));

vi.mock("@/lib/actions/auth", () => ({}));

vi.mock("@/lib/auth/auth.client", () => ({
  authClient: {
    getSession: (...args: unknown[]) => mockGetSession(...args),
  },
  signIn: {
    email: (...args: unknown[]) => mockSignInEmail(...args),
  },
}));

vi.mock("@/lib/gtm-events", () => ({
  fireGTMEvent: {
    viewLoginArea: vi.fn(),
    loginAreaFormStart: vi.fn(),
    signIn: vi.fn(),
  },
}));

vi.mock("@/lib/auth/auth.utils", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth/auth.utils")>(
    "@/lib/auth/auth.utils",
  );
  return {
    ...actual,
    waitForAuthSession: (...args: unknown[]) => mockWaitForAuthSession(...args),
  };
});

describe("SignInForm", () => {
  beforeEach(() => {
    mockReplace.mockReset();
    mockSignInEmail.mockReset();
    mockGetSession.mockReset();
    mockWaitForAuthSession.mockReset();
    mockWaitForAuthSession.mockResolvedValue(undefined);
    mockSearchParams = new URLSearchParams();
  });

  async function submitValidSignInForm() {
    const user = userEvent.setup();

    await user.type(
      screen.getByPlaceholderText("Fields.Email.placeholder"),
      "login-user@example.com",
    );
    await user.type(
      screen.getByPlaceholderText("Fields.Password.placeholder"),
      "Passw0rd!",
    );
    await user.click(screen.getByRole("button", { name: "submit" }));
  }

  it("renders the email last-used inline marker inside the submit button", () => {
    render(<SignInForm isLastUsedEmailLogin />);

    const submitButton = screen.getByRole("button", { name: "submit" });
    const lastUsedLabel = screen.getByText("last-used");
    const badgeContainer = submitButton.parentElement;

    expect(lastUsedLabel).toBeInTheDocument();
    expect(lastUsedLabel).toHaveClass(
      "absolute",
      "top-1/2",
      "right-2",
      "-translate-y-1/2",
      "rounded-full",
      "border",
      "bg-background",
      "text-foreground",
      "border-border",
    );
    expect(badgeContainer).toHaveClass("relative");
    expect(badgeContainer).toContainElement(lastUsedLabel);
  });

  it("toggles the password field visibility", async () => {
    const user = userEvent.setup();

    render(<SignInForm />);

    const passwordField = screen.getByPlaceholderText(
      "Fields.Password.placeholder",
    ) as HTMLInputElement;

    await user.type(passwordField, "Passw0rd!");
    passwordField.focus();
    passwordField.setSelectionRange(4, 4);

    expect(passwordField).toHaveFocus();
    expect(passwordField.selectionStart).toBe(4);
    expect(passwordField.selectionEnd).toBe(4);
    expect(passwordField).toHaveAttribute("type", "password");

    await user.click(
      screen.getByRole("button", { name: "PasswordToggle.show" }),
    );

    await waitFor(() => {
      expect(passwordField).toHaveFocus();
      expect(passwordField.selectionStart).toBe(4);
      expect(passwordField.selectionEnd).toBe(4);
      expect(passwordField).toHaveAttribute("type", "text");
      expect(
        screen.getByRole("button", { name: "PasswordToggle.hide" }),
      ).toBeInTheDocument();
    });
  });

  it("focuses the password field when submit hits a missing password error", async () => {
    const user = userEvent.setup();

    render(<SignInForm />);

    await user.type(
      screen.getByPlaceholderText("Fields.Email.placeholder"),
      "login-user@example.com",
    );
    await user.click(screen.getByRole("button", { name: "submit" }));

    await waitFor(() => {
      expect(
        screen.getByPlaceholderText("Fields.Password.placeholder"),
      ).toHaveFocus();
    });
  });

  it("passes unwrapped session data to waitForAuthSession after credential login", async () => {
    mockSignInEmail.mockResolvedValue({
      data: {},
      error: null,
    });
    mockGetSession.mockResolvedValueOnce({
      data: null,
      error: null,
    });

    render(<SignInForm />);

    await submitValidSignInForm();

    await waitFor(() => {
      expect(mockWaitForAuthSession).toHaveBeenCalledTimes(1);
    });

    const waitForAuthSessionOptions = mockWaitForAuthSession.mock
      .calls[0]?.[0] as {
      getSession: () => Promise<null | { id: string }>;
    };

    await expect(waitForAuthSessionOptions.getSession()).resolves.toBeNull();
  });
});
