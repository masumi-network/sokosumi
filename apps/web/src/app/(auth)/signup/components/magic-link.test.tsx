import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { captchaFetchOptions } from "@/test/auth-captcha-mock";

import { SignUpMagicLink } from "./magic-link";

const magicLinkMock = vi.fn();

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("@vercel/analytics", () => ({ track: vi.fn() }));

vi.mock("sonner", () => ({
  toast: { error: vi.fn() },
}));

vi.mock("@/lib/auth/auth.client", () => ({
  authClient: {
    signIn: { magicLink: (...args: unknown[]) => magicLinkMock(...args) },
  },
}));

vi.mock("@/components/auth-captcha", () => import("@/test/auth-captcha-mock"));

describe("SignUpMagicLink", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    magicLinkMock.mockResolvedValue({ data: {}, error: null });
  });

  it("sends the link to the confirmed email and then offers a resend", async () => {
    const user = userEvent.setup();
    render(<SignUpMagicLink email="ada@example.com" returnUrl="/agents" />);
    expect(screen.getByRole("status")).toBeEmptyDOMElement();

    await user.click(screen.getByRole("button", { name: "magicLinkSubmit" }));

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent("magicLinkSuccess");
    });
    expect(magicLinkMock).toHaveBeenCalledTimes(1);
    const request = magicLinkMock.mock.calls[0]?.[0] as {
      email: string;
      callbackURL: string;
      fetchOptions: unknown;
    };
    expect(request.email).toBe("ada@example.com");
    expect(request.fetchOptions).toBe(captchaFetchOptions);
    expect(request.callbackURL).toContain("/auth/callback/signin");
    expect(request.callbackURL).toContain(encodeURIComponent("/agents"));
    expect(
      screen.getByRole("button", { name: "magicLinkResend" }),
    ).toBeEnabled();
  });

  it("reports a failed request and claims nothing was sent", async () => {
    const user = userEvent.setup();
    magicLinkMock.mockResolvedValue({
      data: null,
      error: { message: "Too many requests" },
    });
    render(<SignUpMagicLink email="ada@example.com" returnUrl={undefined} />);

    await user.click(screen.getByRole("button", { name: "magicLinkSubmit" }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("Too many requests");
    });
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
    expect(
      screen.getByRole("button", { name: "magicLinkSubmit" }),
    ).toBeEnabled();
  });
});
