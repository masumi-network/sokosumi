import "@testing-library/jest-dom";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { buildOAuthConsentReturnUrlFromSearchParams } from "@/lib/utils/auth-redirect";

import SocialButtons from "../social-buttons";

const mockSocialSignIn = jest.fn();

let mockSearchParams = new URLSearchParams();

jest.mock("next/navigation", () => ({
  useSearchParams: () => mockSearchParams as unknown as URLSearchParams,
}));

jest.mock("next-intl", () => ({
  useTranslations: () => {
    return (
      key: string,
      values?: {
        provider?: string;
      },
    ) => {
      if (key === "continueWith") {
        return `continue-with-${values?.provider ?? "unknown"}`;
      }
      return key;
    };
  },
}));

jest.mock("@vercel/analytics", () => ({
  track: jest.fn(),
}));

jest.mock("sonner", () => ({
  toast: {
    error: jest.fn(),
  },
}));

jest.mock("@/lib/auth/auth.client", () => ({
  authClient: {
    signIn: {
      social: (...args: unknown[]) => mockSocialSignIn(...args),
    },
  },
}));

interface MockSocialButtonProps {
  onClick?: () => void;
  text?: string;
}

function MockSocialButton({ onClick, text }: MockSocialButtonProps) {
  return (
    <button type="button" onClick={onClick}>
      {text}
    </button>
  );
}

jest.mock("react-social-login-buttons", () => ({
  GoogleLoginButton: MockSocialButton,
  MicrosoftLoginButton: MockSocialButton,
}));

describe("SocialButtons", () => {
  beforeEach(() => {
    mockSocialSignIn.mockReset();
    mockSocialSignIn.mockResolvedValue({});
    mockSearchParams = new URLSearchParams();
  });

  async function clickGoogleButton() {
    const user = userEvent.setup();
    await user.click(
      screen.getByRole("button", { name: "continue-with-Google" }),
    );
  }

  function getSubmittedReturnUrl(): string | null {
    const payload = mockSocialSignIn.mock.calls[0]?.[0] as {
      callbackURL: string;
    };
    const callbackUrl = new URL(payload.callbackURL, "https://example.com");
    return callbackUrl.searchParams.get("returnUrl");
  }

  it("passes provided returnUrl to social sign-in callbacks", async () => {
    render(<SocialButtons returnUrl="/oauth/consent?client_id=prop-client" />);

    await clickGoogleButton();

    await waitFor(() => {
      expect(mockSocialSignIn).toHaveBeenCalledTimes(1);
    });

    expect(getSubmittedReturnUrl()).toBe("/oauth/consent?client_id=prop-client");
  });

  it("builds oauth consent returnUrl from signed query when prop is missing", async () => {
    mockSearchParams = new URLSearchParams({
      client_id: "test-client",
      redirect_uri: "https://consumer.example.com/callback",
      code_challenge: "test-challenge",
      code_challenge_method: "S256",
      scope: "openid offline_access",
      state: "test-state",
      response_type: "code",
      exp: "1772367377",
      sig: "signed-value",
    });

    const expectedReturnUrl = buildOAuthConsentReturnUrlFromSearchParams(
      new URLSearchParams(mockSearchParams.toString()),
    );

    render(<SocialButtons />);

    await clickGoogleButton();

    await waitFor(() => {
      expect(mockSocialSignIn).toHaveBeenCalledTimes(1);
    });

    expect(getSubmittedReturnUrl()).toBe(expectedReturnUrl);
  });
});
