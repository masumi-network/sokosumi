import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { betterAuth } from "better-auth/minimal";
import { magicLink } from "better-auth/plugins/magic-link";
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
    // Better Auth decodes the callback URL once more during verification.
    const callbackURL = decodeURIComponent(request.callbackURL);
    expect(callbackURL).toContain("/auth/callback/signin");
    expect(callbackURL).toContain(encodeURIComponent("/agents"));
    expect(
      screen.getByRole("button", { name: "magicLinkResend" }),
    ).toBeEnabled();
  });

  it.each([
    { pathname: "/signin", signedOAuth: false },
    { pathname: "/signup", signedOAuth: false },
    { pathname: "/signin", signedOAuth: true },
  ])(
    "preserves auth context on $pathname (signed OAuth: $signedOAuth)",
    async ({ pathname, signedOAuth }) => {
      const startPage = window.location.href;
      const target = new URL(pathname, window.location.origin);
      target.searchParams.set("returnUrl", "/chat?room=a&tab=files#messages");
      target.searchParams.set("email", "ada+tag@example.com");
      target.searchParams.set("invitationId", "invitation-1");
      target.searchParams.set("hint", "100% complete");
      if (signedOAuth) {
        target.searchParams.set("client_id", "cmo");
        target.searchParams.set(
          "redirect_uri",
          "https://cmo.test/callback?a=1&b=2",
        );
        target.searchParams.set("state", "a&b=c");
        target.searchParams.set("prompt", "login");
        target.searchParams.set("max_age", "0");
        target.searchParams.set("exp", "9999999999");
        target.searchParams.set("sig", "a+b/c=");
        for (const key of [
          "client_id",
          "redirect_uri",
          "state",
          "prompt",
          "max_age",
          "exp",
          "ba_param",
        ]) {
          target.searchParams.append("ba_param", key);
        }
      }
      const previousAttempt = new URL(target);
      previousAttempt.searchParams.set("error", "access_denied");
      previousAttempt.searchParams.set("error_description", "old failure");
      window.history.replaceState(null, "", previousAttempt);
      let sentUrl = "";
      const auth = betterAuth({
        baseURL: "https://core.test",
        secret: "offline-magic-link-fixture-secret-32-characters",
        trustedOrigins: [window.location.origin],
        advanced: { disableOriginCheck: false },
        plugins: [
          magicLink({
            async sendMagicLink({ url }) {
              sentUrl = url;
            },
          }),
        ],
      });
      magicLinkMock.mockImplementation(async (body) => {
        const response = await auth.handler(
          new Request("https://core.test/api/auth/sign-in/magic-link", {
            method: "POST",
            headers: {
              origin: window.location.origin,
              "content-type": "application/json",
            },
            body: JSON.stringify(body),
          }),
        );
        expect(response.status).toBe(200);
        return { data: await response.json(), error: null };
      });
      try {
        const user = userEvent.setup();
        render(
          <SignUpMagicLink email="ada@example.com" returnUrl={undefined} />,
        );
        await user.click(
          screen.getByRole("button", { name: "magicLinkSubmit" }),
        );
        await waitFor(() => expect(sentUrl).not.toBe(""));
        // No email or account creation: only exercise the invalid-token handler.
        const verification = new URL(sentUrl);
        verification.searchParams.set("token", "expired-fixture-token");
        const response = await auth.handler(new Request(verification));
        target.searchParams.set("error", "INVALID_TOKEN");
        expect(response.status).toBe(302);
        expect(response.headers.get("location")).toBe(target.href);
      } finally {
        window.history.replaceState(null, "", startPage);
      }
    },
  );

  it("returns a verified link to the callback page with the whole return URL", async () => {
    let sentUrl = "";
    const auth = betterAuth({
      baseURL: "https://core.test",
      secret: "offline-magic-link-fixture-secret-32-characters",
      trustedOrigins: [window.location.origin],
      advanced: { disableOriginCheck: false },
      plugins: [
        magicLink({
          async sendMagicLink({ url }) {
            sentUrl = url;
          },
        }),
      ],
    });
    magicLinkMock.mockImplementation(async (body) => {
      const response = await auth.handler(
        new Request("https://core.test/api/auth/sign-in/magic-link", {
          method: "POST",
          headers: {
            origin: window.location.origin,
            "content-type": "application/json",
          },
          body: JSON.stringify(body),
        }),
      );
      expect(response.status).toBe(200);
      return { data: await response.json(), error: null };
    });
    const user = userEvent.setup();
    render(
      <SignUpMagicLink
        email="ada@example.com"
        returnUrl="/chat?room=a&tab=files"
      />,
    );

    await user.click(screen.getByRole("button", { name: "magicLinkSubmit" }));
    await waitFor(() => expect(sentUrl).not.toBe(""));
    // The fixture's in-memory adapter holds the account the link creates.
    const response = await auth.handler(new Request(sentUrl));

    expect(response.status).toBe(302);
    const location = new URL(response.headers.get("location") ?? "");
    expect(location.origin + location.pathname).toBe(
      `${window.location.origin}/auth/callback/signin`,
    );
    expect(Object.fromEntries(location.searchParams)).toEqual({
      provider: "magic-link",
      returnUrl: "/chat?room=a&tab=files",
    });
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
