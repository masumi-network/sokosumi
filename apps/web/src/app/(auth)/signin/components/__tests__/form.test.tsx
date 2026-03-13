import "@testing-library/jest-dom";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import SignInForm from "../form";

const mockReplace = jest.fn();
const mockSignInEmail = jest.fn();
const mockGetSession = jest.fn();
const mockWaitForAuthSession = jest.fn().mockResolvedValue(undefined);

let mockSearchParams = new URLSearchParams();

jest.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: mockReplace,
  }),
  useSearchParams: () => mockSearchParams as unknown as URLSearchParams,
}));

jest.mock("next-intl", () => ({
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

jest.mock("@vercel/analytics", () => ({
  track: jest.fn(),
}));

jest.mock("@sentry/nextjs", () => ({
  captureMessage: jest.fn(),
}));

jest.mock("sonner", () => ({
  toast: {
    success: jest.fn(),
    error: jest.fn(),
  },
}));

jest.mock("@/lib/actions", () => ({
  AuthErrorCode: {
    TERMS_NOT_ACCEPTED: "TERMS_NOT_ACCEPTED",
  },
}));

jest.mock("@/lib/actions/auth", () => ({
  signInEmail: (...args: unknown[]) => mockSignInEmail(...args),
}));

jest.mock("@/lib/auth/auth.client", () => ({
  authClient: {
    getSession: (...args: unknown[]) => mockGetSession(...args),
  },
}));

jest.mock("@/lib/gtm-events", () => ({
  fireGTMEvent: {
    viewLoginArea: jest.fn(),
    loginAreaFormStart: jest.fn(),
    signIn: jest.fn(),
  },
}));

jest.mock("@/lib/utils/auth-redirect", () => {
  const actual = jest.requireActual("@/lib/utils/auth-redirect");
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

  it("renders the email last-used badge over the submit button", () => {
    render(<SignInForm isLastUsedEmailLogin />);

    const submitButton = screen.getByRole("button", { name: "submit" });
    const lastUsedBadge = screen.getByText("last-used");
    const badgeContainer = submitButton.parentElement;

    expect(lastUsedBadge).toBeInTheDocument();
    expect(lastUsedBadge).toHaveClass("absolute");
    expect(badgeContainer).toHaveClass("relative");
    expect(badgeContainer).toContainElement(lastUsedBadge);
  });

  it("passes unwrapped session data to waitForAuthSession after credential login", async () => {
    mockSignInEmail.mockResolvedValue({
      ok: true,
      data: {},
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
