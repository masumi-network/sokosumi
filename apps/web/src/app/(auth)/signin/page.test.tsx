import { render, screen } from "@testing-library/react";
import { err, ok } from "neverthrow";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const cookiesMock = vi.fn();
const getMock = vi.fn();
const signInFlowMock = vi.fn();
const getEnvSecretsMock = vi.fn();
const handBackMock = vi.fn();
const getSessionMock = vi.fn();
const getOAuthClientPublicPreloginMock = vi.fn();
const getOAuthClientPublicMock = vi.fn();

// The clock reads 10:00:00; Core signs a request for ten minutes.
const NOW = Date.parse("2026-09-30T10:00:00.000Z");
const OAUTH_SEARCH_PARAMS = {
  client_id: "cmo",
  redirect_uri: "https://app.cmo.xyz/api/auth/callback/sokosumi",
  exp: String(NOW / 1000 + 600),
  sig: "signed-value",
};
const OAUTH_QUERY = `client_id=cmo&redirect_uri=https%3A%2F%2Fapp.cmo.xyz%2Fapi%2Fauth%2Fcallback%2Fsokosumi&exp=${NOW / 1000 + 600}&sig=signed-value`;

const getPendingInvitationMock = vi.fn();
vi.mock("@/lib/services/organization.service", () => ({
  organizationService: {
    getPendingInvitation: (id: string) => getPendingInvitationMock(id),
  },
}));

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

vi.mock("./components/sign-in-flow", () => ({
  __esModule: true,
  default: (props: { notice: ReactNode; children: ReactNode }) => {
    signInFlowMock(props);
    return (
      <div data-testid="sign-in-form">
        {props.notice}
        {props.children}
      </div>
    );
  },
}));

vi.mock("@/auth/components/terms-notice", () => ({
  __esModule: true,
  default: () => <div data-testid="terms-notice" />,
}));

vi.mock("@/auth/components/oauth-hand-back", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/auth/components/oauth-hand-back")
  >()),
  default: (props: unknown) => {
    handBackMock(props);
    return <div data-testid="oauth-hand-back" />;
  },
}));

vi.mock("@/lib/auth/auth.server", () => ({
  getSession: () => getSessionMock(),
  getOAuthClientPublic: (clientId: string) =>
    getOAuthClientPublicMock(clientId),
  getOAuthClientPublicPrelogin: (clientId: string, oauthQuery: string) =>
    getOAuthClientPublicPreloginMock(clientId, oauthQuery),
}));

describe("SignIn page", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"], now: NOW });
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
    getOAuthClientPublicPreloginMock.mockResolvedValue({
      client_id: "cmo",
      client_name: "CMO",
      client_uri: "https://cmo.xyz",
      logo_uri: "https://cmo.xyz/logo.png",
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("says the request from another app has expired instead of showing the form", async () => {
    const { default: Page } = await import("./page");

    render(
      await Page({
        searchParams: Promise.resolve({
          ...OAUTH_SEARCH_PARAMS,
          exp: String(NOW / 1000 - 60),
        }),
      }),
    );

    expect(screen.getByRole("alert")).toHaveTextContent("errorTitle");
    expect(screen.getByRole("alert")).toHaveTextContent("errorDescription");
    expect(
      screen.getByRole("link", { name: "backToSokosumi" }),
    ).toHaveAttribute("href", "/");
    expect(screen.queryByTestId("sign-in-form")).not.toBeInTheDocument();
    expect(handBackMock).not.toHaveBeenCalled();
    expect(getOAuthClientPublicMock).not.toHaveBeenCalled();
    expect(getOAuthClientPublicPreloginMock).not.toHaveBeenCalled();
  });

  it("names the app a signed-in person came from when their request has expired", async () => {
    getSessionMock.mockResolvedValue({ session: { id: "session-1" } });
    getOAuthClientPublicMock.mockResolvedValue(
      ok({ client_name: "CMO", client_uri: "https://cmo.xyz" }),
    );
    const { default: Page } = await import("./page");

    render(
      await Page({
        searchParams: Promise.resolve({
          ...OAUTH_SEARCH_PARAMS,
          exp: String(NOW / 1000 - 60),
        }),
      }),
    );

    expect(screen.getByRole("alert")).toHaveTextContent("errorTitleFor");
    expect(screen.getByRole("alert")).toHaveTextContent("errorDescriptionFor");
    expect(screen.getByRole("link", { name: "backTo" })).toHaveAttribute(
      "href",
      "https://cmo.xyz/",
    );
    expect(screen.queryByTestId("sign-in-form")).not.toBeInTheDocument();
    expect(handBackMock).not.toHaveBeenCalled();
    expect(getOAuthClientPublicMock).toHaveBeenCalledOnce();
    expect(getOAuthClientPublicPreloginMock).not.toHaveBeenCalled();
  });

  it.each([ok(null), err({ reason: "http", status: 503 })])(
    "keeps the expired error generic when the session client lookup fails (%o)",
    async (result) => {
      getSessionMock.mockResolvedValue({ session: { id: "session-1" } });
      getOAuthClientPublicMock.mockResolvedValue(result);
      const { default: Page } = await import("./page");
      render(
        await Page({
          searchParams: Promise.resolve({
            ...OAUTH_SEARCH_PARAMS,
            exp: String(NOW / 1000 - 60),
          }),
        }),
      );
      expect(screen.getByRole("alert")).toHaveTextContent("errorDescription");
      expect(
        screen.getByRole("link", { name: "backToSokosumi" }),
      ).toHaveAttribute("href", "/");
      expect(screen.queryByTestId("sign-in-form")).not.toBeInTheDocument();
      expect(handBackMock).not.toHaveBeenCalled();
      expect(getOAuthClientPublicPreloginMock).not.toHaveBeenCalled();
    },
  );

  it.each([String(NOW / 1000 - 30), "soon"])(
    "leaves boundary or malformed expiry with the existing form (%s)",
    async (exp) => {
      getOAuthClientPublicPreloginMock.mockResolvedValue(null);
      const { default: Page } = await import("./page");
      render(
        await Page({
          searchParams: Promise.resolve({ ...OAUTH_SEARCH_PARAMS, exp }),
        }),
      );
      expect(screen.getByTestId("sign-in-form")).toBeInTheDocument();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      expect(handBackMock).not.toHaveBeenCalled();
      expect(getOAuthClientPublicMock).not.toHaveBeenCalled();
      expect(getOAuthClientPublicPreloginMock).toHaveBeenCalledOnce();
    },
  );

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

  it("shows the product the person is continuing to", async () => {
    const { default: Page } = await import("./page");

    render(await Page({ searchParams: Promise.resolve(OAUTH_SEARCH_PARAMS) }));

    // Asked with the signed request: the person is not signed in yet.
    expect(getOAuthClientPublicPreloginMock).toHaveBeenCalledWith(
      "cmo",
      OAUTH_QUERY,
    );
    expect(signInFlowMock).toHaveBeenCalledWith(
      expect.objectContaining({
        client: {
          name: "CMO",
          uri: "https://cmo.xyz/",
          logoUri: "https://cmo.xyz/logo.png",
        },
      }),
    );
  });

  it("shows no product without an OAuth request", async () => {
    const { default: Page } = await import("./page");

    render(await Page({ searchParams: Promise.resolve({}) }));

    expect(getOAuthClientPublicPreloginMock).not.toHaveBeenCalled();
    expect(getSessionMock).not.toHaveBeenCalled();
    expect(signInFlowMock).toHaveBeenCalledWith(
      expect.objectContaining({ client: undefined }),
    );
  });

  it("falls back to the plain header when the product cannot be loaded", async () => {
    getOAuthClientPublicPreloginMock.mockResolvedValue(null);
    const { default: Page } = await import("./page");

    render(await Page({ searchParams: Promise.resolve(OAUTH_SEARCH_PARAMS) }));

    expect(signInFlowMock).toHaveBeenCalledWith(
      expect.objectContaining({ client: undefined }),
    );
    expect(screen.getByTestId("sign-in-form")).toBeInTheDocument();
  });

  it("hands a signed-in person with an OAuth request back to the provider", async () => {
    getSessionMock.mockResolvedValue({ session: { id: "session-1" } });
    const { default: Page } = await import("./page");

    render(await Page({ searchParams: Promise.resolve(OAUTH_SEARCH_PARAMS) }));

    expect(handBackMock).toHaveBeenCalledWith({
      oauthQuery: OAUTH_QUERY,
      client: {
        name: "CMO",
        uri: "https://cmo.xyz/",
        logoUri: "https://cmo.xyz/logo.png",
      },
    });
    expect(screen.queryByTestId("sign-in-form")).not.toBeInTheDocument();
  });

  it("asks a signed-in person which account to use when the product asks for a new one", async () => {
    getSessionMock.mockResolvedValue({
      session: { id: "session-1" },
      user: { id: "user-1", name: "Ada Lovelace", email: "ada@example.com" },
    });
    const { default: Page } = await import("./page");

    render(
      await Page({
        searchParams: Promise.resolve({
          ...OAUTH_SEARCH_PARAMS,
          prompt: "create",
        }),
      }),
    );

    expect(handBackMock).toHaveBeenCalledWith({
      oauthQuery: `${OAUTH_QUERY}&prompt=create`,
      client: {
        name: "CMO",
        uri: "https://cmo.xyz/",
        logoUri: "https://cmo.xyz/logo.png",
      },
      accountToConfirm: {
        id: "user-1",
        name: "Ada Lovelace",
        email: "ada@example.com",
      },
    });
    expect(screen.queryByTestId("sign-in-form")).not.toBeInTheDocument();
  });

  it("shows the form to a signed-out person when the product asks for a new account", async () => {
    const { default: Page } = await import("./page");

    render(
      await Page({
        searchParams: Promise.resolve({
          ...OAUTH_SEARCH_PARAMS,
          prompt: "create",
        }),
      }),
    );

    expect(handBackMock).not.toHaveBeenCalled();
    expect(screen.getByTestId("sign-in-form")).toBeInTheDocument();
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

  it("opens the flow on the method this browser used last", async () => {
    getMock.mockReturnValue({ value: "email" });
    const { default: Page } = await import("./page");

    render(
      await Page({
        searchParams: Promise.resolve({}),
      }),
    );

    expect(signInFlowMock).toHaveBeenCalledWith(
      expect.objectContaining({ lastUsedMethod: "email" }),
    );
  });

  it("ignores a last-login cookie it does not know", async () => {
    getMock.mockReturnValue({ value: "magic-link" });
    const { default: Page } = await import("./page");

    render(await Page({ searchParams: Promise.resolve({}) }));

    expect(signInFlowMock).toHaveBeenCalledWith(
      expect.objectContaining({ lastUsedMethod: null }),
    );
  });

  // The address never travels in the URL, which reaches logs and analytics.
  it("locks the address the invitation names, not one from the URL", async () => {
    getPendingInvitationMock.mockResolvedValue({
      invitation: { id: "inv_1", email: "invited@example.com" },
    });
    const { default: Page } = await import("./page");

    render(
      await Page({
        searchParams: Promise.resolve({
          email: "someone-else@example.com",
          invitationId: "inv_1",
          returnUrl: "/accept-invitation/inv_1",
        }),
      }),
    );

    expect(getPendingInvitationMock).toHaveBeenCalledWith("inv_1");
    expect(signInFlowMock).toHaveBeenCalledWith(
      expect.objectContaining({
        prefilledEmail: "invited@example.com",
        invitationId: "inv_1",
        returnUrl: "/accept-invitation/inv_1",
      }),
    );
  });

  it("signs in without a lock when the invitation cannot be read", async () => {
    getPendingInvitationMock.mockRejectedValue(new Error("Core down"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { default: Page } = await import("./page");

    render(
      await Page({
        searchParams: Promise.resolve({ invitationId: "inv_1" }),
      }),
    );

    expect(signInFlowMock).toHaveBeenCalledWith(
      expect.objectContaining({ prefilledEmail: undefined }),
    );
  });

  it("explains why a sign-in brought the person back", async () => {
    const { default: Page } = await import("./page");

    render(
      await Page({
        searchParams: Promise.resolve({ error: "account_not_linked" }),
      }),
    );

    expect(screen.getByRole("alert")).toHaveTextContent("accountNotLinked");
  });

  it("shows no error notice on a plain visit", async () => {
    const { default: Page } = await import("./page");

    render(await Page({ searchParams: Promise.resolve({}) }));

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
