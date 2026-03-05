import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";

import SignInForm from "../form";

const mockGetLastUsedLoginMethod = jest.fn();

let mockSearchParams = new URLSearchParams();

jest.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: jest.fn(),
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
  signInEmail: jest.fn(),
}));

jest.mock("@/lib/auth/auth.client", () => ({
  authClient: {
    getLastUsedLoginMethod: () => mockGetLastUsedLoginMethod(),
    getSession: jest.fn(),
  },
}));

jest.mock("@/lib/gtm-events", () => ({
  fireGTMEvent: {
    viewLoginArea: jest.fn(),
    loginAreaFormStart: jest.fn(),
    signIn: jest.fn(),
  },
}));

describe("SignInForm", () => {
  beforeEach(() => {
    mockGetLastUsedLoginMethod.mockReset();
    mockGetLastUsedLoginMethod.mockReturnValue(null);
    mockSearchParams = new URLSearchParams();
  });

  it("renders the email last-used badge over the submit button", () => {
    mockGetLastUsedLoginMethod.mockReturnValue("email");

    render(<SignInForm />);

    const submitButton = screen.getByRole("button", { name: "submit" });
    const lastUsedBadge = screen.getByText("last-used");
    const badgeContainer = submitButton.parentElement;

    expect(lastUsedBadge).toBeInTheDocument();
    expect(lastUsedBadge).toHaveClass("absolute");
    expect(badgeContainer).toHaveClass("relative");
    expect(badgeContainer).toContainElement(lastUsedBadge);
  });
});
