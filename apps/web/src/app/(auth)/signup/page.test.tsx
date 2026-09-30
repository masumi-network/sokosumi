import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const cookiesMock = vi.fn();
const getMock = vi.fn();
const signUpFlowMock = vi.fn();
const getEnvSecretsMock = vi.fn();
const handBackMock = vi.fn();
const getSessionMock = vi.fn();
const getOAuthClientPublicPreloginMock = vi.fn();

const OAUTH_SEARCH_PARAMS = {
  client_id: "cmo",
  redirect_uri: "https://app.cmo.xyz/api/auth/callback/sokosumi",
  exp: "1772367377",
  sig: "signed-value",
};
const OAUTH_QUERY =
  "client_id=cmo&redirect_uri=https%3A%2F%2Fapp.cmo.xyz%2Fapi%2Fauth%2Fcallback%2Fsokosumi&exp=1772367377&sig=signed-value";

vi.mock("next/headers", () => ({
  cookies: () => cookiesMock(),
}));

vi.mock("next-intl/server", () => ({
  getTranslations: async () => (key: string) => key,
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("@/config/env.secrets", () => ({
  getEnvSecrets: () => getEnvSecretsMock(),
}));

vi.mock("./components/sign-up-flow", () => ({
  __esModule: true,
  default: ({
    children,
    notice,
    ...props
  }: {
    children?: ReactNode;
    notice?: ReactNode;
  }) => {
    signUpFlowMock(props);
    return (
      <div data-testid="sign-up-flow">
        {notice}
        {children}
      </div>
    );
  },
}));

vi.mock("@/auth/components/terms-notice", () => ({
  __esModule: true,
  default: () => <div data-testid="terms-notice" />,
}));

vi.mock("@/auth/components/oauth-hand-back", () => ({
  __esModule: true,
  default: (props: unknown) => {
    handBackMock(props);
    return <div data-testid="oauth-hand-back" />;
  },
}));

vi.mock("@/lib/auth/auth.server", () => ({
  getSession: () => getSessionMock(),
  getOAuthClientPublicPrelogin: (clientId: string, oauthQuery: string) =>
    getOAuthClientPublicPreloginMock(clientId, oauthQuery),
}));

describe("SignUp page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getMock.mockReturnValue({ value: "magic-link" });
    cookiesMock.mockResolvedValue({
      get: getMock,
    });
    getEnvSecretsMock.mockReturnValue({
      NETWORK: "Preprod",
      VERCEL_GIT_COMMIT_REF: "feature/123",
      VERCEL_ENV: "preview",
    });
    getSessionMock.mockResolvedValue(null);
    getOAuthClientPublicPreloginMock.mockResolvedValue({
      client_id: "cmo",
      client_name: "CMO",
    });
  });

  it("reads the last-login cookie using the configured preview prefix", async () => {
    const { default: SignUpPage } = await import("./page");

    render(
      await SignUpPage({
        searchParams: Promise.resolve({}),
      }),
    );

    expect(getMock).toHaveBeenCalledWith(
      "sokosumi-preview-preprod-feature-123.last_used_login_method",
    );
  });

  it("hands the invitation email and the last-used provider to the flow", async () => {
    getMock.mockReturnValue({ value: "google" });
    const { default: Page } = await import("./page");

    render(
      await Page({
        searchParams: Promise.resolve({
          email: "ada@example.com",
          invitationId: "inv_1",
          returnUrl: "/agents",
        }),
      }),
    );

    expect(signUpFlowMock).toHaveBeenCalledWith({
      invitationId: "inv_1",
      clientName: undefined,
      prefilledEmail: "ada@example.com",
      returnUrl: "/agents",
      lastUsedMethod: "google",
      showMagicLink: true,
    });
  });

  it("says that creating an account accepts the terms", async () => {
    const { default: Page } = await import("./page");

    render(await Page({ searchParams: Promise.resolve({}) }));

    expect(screen.getByTestId("terms-notice")).toBeInTheDocument();
  });

  it("names the product the person is continuing to", async () => {
    const { default: Page } = await import("./page");

    render(await Page({ searchParams: Promise.resolve(OAUTH_SEARCH_PARAMS) }));

    // Asked with the signed request: the person is not signed in yet.
    expect(getOAuthClientPublicPreloginMock).toHaveBeenCalledWith(
      "cmo",
      OAUTH_QUERY,
    );
    expect(signUpFlowMock).toHaveBeenCalledWith(
      expect.objectContaining({ clientName: "CMO" }),
    );
  });

  it("names no product without an OAuth request", async () => {
    const { default: Page } = await import("./page");

    render(await Page({ searchParams: Promise.resolve({}) }));

    expect(getOAuthClientPublicPreloginMock).not.toHaveBeenCalled();
    expect(getSessionMock).not.toHaveBeenCalled();
    expect(signUpFlowMock).toHaveBeenCalledWith(
      expect.objectContaining({ clientName: undefined }),
    );
  });

  it("falls back to the plain header when the product cannot be loaded", async () => {
    getOAuthClientPublicPreloginMock.mockResolvedValue(null);
    const { default: Page } = await import("./page");

    render(await Page({ searchParams: Promise.resolve(OAUTH_SEARCH_PARAMS) }));

    expect(signUpFlowMock).toHaveBeenCalledWith(
      expect.objectContaining({ clientName: undefined }),
    );
    expect(screen.getByTestId("sign-up-flow")).toBeInTheDocument();
  });

  it("hands a signed-in person with an OAuth request back to the provider", async () => {
    getSessionMock.mockResolvedValue({ session: { id: "session-1" } });
    const { default: Page } = await import("./page");

    render(await Page({ searchParams: Promise.resolve(OAUTH_SEARCH_PARAMS) }));

    expect(handBackMock).toHaveBeenCalledWith({
      oauthQuery: OAUTH_QUERY,
      clientName: "CMO",
    });
    expect(screen.queryByTestId("sign-up-flow")).not.toBeInTheDocument();
  });

  it("asks a signed-in person to sign in again when the request demands it", async () => {
    getSessionMock.mockResolvedValue({ session: { id: "session-1" } });
    const { default: Page } = await import("./page");

    render(
      await Page({
        searchParams: Promise.resolve({
          ...OAUTH_SEARCH_PARAMS,
          prompt: "login",
        }),
      }),
    );

    expect(handBackMock).not.toHaveBeenCalled();
    expect(screen.getByTestId("sign-up-flow")).toBeInTheDocument();
  });

  it("offers a magic link without an OAuth request", async () => {
    const { default: Page } = await import("./page");

    render(await Page({ searchParams: Promise.resolve({}) }));

    expect(signUpFlowMock).toHaveBeenCalledWith(
      expect.objectContaining({ showMagicLink: true }),
    );
  });

  it("offers no magic link with an OAuth request", async () => {
    const { default: Page } = await import("./page");

    render(await Page({ searchParams: Promise.resolve(OAUTH_SEARCH_PARAMS) }));

    expect(signUpFlowMock).toHaveBeenCalledWith(
      expect.objectContaining({ showMagicLink: false }),
    );
  });

  it("explains why a sign-in brought the person back", async () => {
    const { default: Page } = await import("./page");

    render(
      await Page({ searchParams: Promise.resolve({ error: "access_denied" }) }),
    );

    expect(screen.getByRole("alert")).toHaveTextContent("cancelled");
  });

  it("shows no error notice on a plain visit", async () => {
    const { default: Page } = await import("./page");

    render(await Page({ searchParams: Promise.resolve({}) }));

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
