import { render, screen } from "@testing-library/react";
import { err, ok } from "neverthrow";
import { beforeEach, describe, expect, it, vi } from "vitest";

const cookiesMock = vi.fn();
const getMock = vi.fn();
const socialButtonsMock = vi.fn();
const signInFormMock = vi.fn();
const getEnvSecretsMock = vi.fn();
const headerMock = vi.fn();
const handBackMock = vi.fn();
const getSessionMock = vi.fn();
const getOAuthClientPublicMock = vi.fn();

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

vi.mock("@/auth/components/divider", () => ({
  __esModule: true,
  default: () => <div data-testid="divider" />,
}));

vi.mock("@/auth/components/social-buttons", () => ({
  __esModule: true,
  default: (props: unknown) => {
    socialButtonsMock(props);
    return <div data-testid="social-buttons" />;
  },
}));

vi.mock("@/config/env.secrets", () => ({
  getEnvSecrets: () => getEnvSecretsMock(),
}));

vi.mock("./components/form", () => ({
  __esModule: true,
  default: (props: unknown) => {
    signInFormMock(props);
    return <div data-testid="sign-in-form" />;
  },
}));

vi.mock("./components/header", () => ({
  __esModule: true,
  default: (props: unknown) => {
    headerMock(props);
    return <div data-testid="sign-in-header" />;
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
  getOAuthClientPublic: (clientId: string) =>
    getOAuthClientPublicMock(clientId),
}));

describe("SignIn page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getMock.mockReturnValue({ value: "passkey" });
    cookiesMock.mockResolvedValue({
      get: getMock,
    });
    getEnvSecretsMock.mockReturnValue({
      NETWORK: "Preprod",
      VERCEL_GIT_COMMIT_REF: "",
      VERCEL_ENV: undefined,
    });
    getSessionMock.mockResolvedValue(null);
    getOAuthClientPublicMock.mockResolvedValue(
      ok({ client_id: "cmo", client_name: "CMO" }),
    );
  });

  it("reads the last-login cookie using the configured prefix", async () => {
    const { default: SignInPage } = await import("./page");

    render(
      await SignInPage({
        searchParams: Promise.resolve({}),
      }),
    );

    expect(getMock).toHaveBeenCalledWith(
      "sokosumi-localhost-preprod.last_used_login_method",
    );
  });

  it("says that creating an account accepts the terms", async () => {
    const { default: Page } = await import("./page");

    render(await Page({ searchParams: Promise.resolve({}) }));

    expect(screen.getByTestId("terms-notice")).toBeInTheDocument();
  });

  it("names the product the person is continuing to", async () => {
    const { default: Page } = await import("./page");

    render(await Page({ searchParams: Promise.resolve(OAUTH_SEARCH_PARAMS) }));

    expect(getOAuthClientPublicMock).toHaveBeenCalledWith("cmo");
    expect(headerMock).toHaveBeenCalledWith(
      expect.objectContaining({ clientName: "CMO" }),
    );
  });

  it("names no product without an OAuth request", async () => {
    const { default: Page } = await import("./page");

    render(await Page({ searchParams: Promise.resolve({}) }));

    expect(getOAuthClientPublicMock).not.toHaveBeenCalled();
    expect(getSessionMock).not.toHaveBeenCalled();
    expect(headerMock).toHaveBeenCalledWith(
      expect.objectContaining({ clientName: undefined }),
    );
  });

  it("falls back to the plain header when the product cannot be loaded", async () => {
    getOAuthClientPublicMock.mockResolvedValue(
      err({ path: "/auth/oauth2/public-client", reason: "timeout" }),
    );
    const { default: Page } = await import("./page");

    render(await Page({ searchParams: Promise.resolve(OAUTH_SEARCH_PARAMS) }));

    expect(headerMock).toHaveBeenCalledWith(
      expect.objectContaining({ clientName: undefined }),
    );
    expect(screen.getByTestId("sign-in-form")).toBeInTheDocument();
  });

  it("hands a signed-in person with an OAuth request back to the provider", async () => {
    getSessionMock.mockResolvedValue({ session: { id: "session-1" } });
    const { default: Page } = await import("./page");

    render(await Page({ searchParams: Promise.resolve(OAUTH_SEARCH_PARAMS) }));

    expect(handBackMock).toHaveBeenCalledWith({
      oauthQuery: OAUTH_QUERY,
      clientName: "CMO",
    });
    expect(screen.queryByTestId("sign-in-form")).not.toBeInTheDocument();
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
    expect(screen.getByTestId("sign-in-form")).toBeInTheDocument();
  });

  it("keeps the magic link with an OAuth request", async () => {
    const { default: Page } = await import("./page");

    render(await Page({ searchParams: Promise.resolve(OAUTH_SEARCH_PARAMS) }));

    expect(socialButtonsMock).toHaveBeenCalledWith(
      expect.objectContaining({ showMagicLink: true }),
    );
  });
});
