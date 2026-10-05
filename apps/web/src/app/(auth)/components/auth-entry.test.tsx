import { render, screen } from "@testing-library/react";
import { err, ok } from "neverthrow";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AuthEntrySearchParams } from "./auth-entry";

const cookiesMock = vi.fn();
const getMock = vi.fn();
const authFlowMock = vi.fn();
const getEnvPublicConfigMock = vi.fn();
const handBackMock = vi.fn();
const getSessionMock = vi.fn();
const getOAuthClientPublicPreloginMock = vi.fn();
const getOAuthClientPublicMock = vi.fn();
const getPendingInvitationMock = vi.fn();

// The clock reads 10:00:00; Core signs a request for ten minutes.
const NOW = Date.parse("2026-09-30T10:00:00.000Z");
const OAUTH_SEARCH_PARAMS = {
  client_id: "cmo",
  redirect_uri: "https://app.cmo.xyz/api/auth/callback/sokosumi",
  exp: String(NOW / 1000 + 600),
  sig: "signed-value",
};
const OAUTH_QUERY = `client_id=cmo&redirect_uri=https%3A%2F%2Fapp.cmo.xyz%2Fapi%2Fauth%2Fcallback%2Fsokosumi&exp=${NOW / 1000 + 600}&sig=signed-value`;
const CMO = {
  name: "CMO",
  uri: "https://cmo.xyz/",
  logoUri: "https://cmo.xyz/logo.png",
};

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

vi.mock("@/config/env.public", () => ({
  getEnvPublicConfig: () => getEnvPublicConfigMock(),
}));

vi.mock("@/auth/components/auth-flow", () => ({
  __esModule: true,
  default: ({
    children,
    notice,
    ...props
  }: {
    children?: ReactNode;
    notice?: ReactNode;
  }) => {
    authFlowMock(props);
    return (
      <div data-testid="auth-flow">
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

type Page = (props: {
  searchParams: Promise<AuthEntrySearchParams>;
}) => ReactNode | Promise<ReactNode>;

// Through both pages, so each one is seen passing its own mode.
const PAGES = [
  {
    mode: "signIn",
    load: async (): Promise<Page> =>
      (await import("@/auth/signin/page")).default,
  },
  {
    mode: "signUp",
    load: async (): Promise<Page> =>
      (await import("@/auth/signup/page")).default,
  },
] as const;

describe.each(PAGES)("renderAuthEntry on the $mode page", ({ mode, load }) => {
  async function renderPage(searchParams: AuthEntrySearchParams = {}) {
    const Page = await load();
    render(await Page({ searchParams: Promise.resolve(searchParams) }));
  }

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"], now: NOW });
    vi.clearAllMocks();
    getMock.mockReturnValue(undefined);
    cookiesMock.mockResolvedValue({ get: getMock });
    getEnvPublicConfigMock.mockReturnValue({
      NEXT_PUBLIC_NETWORK: "Preprod",
      NEXT_PUBLIC_VERCEL_GIT_COMMIT_REF: "",
      NEXT_PUBLIC_VERCEL_ENV: undefined,
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
    // The unreadable-invitation case silences console.error.
    vi.restoreAllMocks();
  });

  it("opens the flow in this page's mode", async () => {
    await renderPage();

    expect(authFlowMock).toHaveBeenCalledWith(
      expect.objectContaining({ mode }),
    );
  });

  it("says the request from another app has expired instead of showing the form", async () => {
    await renderPage({
      ...OAUTH_SEARCH_PARAMS,
      exp: String(NOW / 1000 - 60),
    });

    expect(screen.getByRole("alert")).toHaveTextContent("errorTitle");
    expect(screen.getByRole("alert")).toHaveTextContent("errorDescription");
    expect(
      screen.getByRole("link", { name: "backToSokosumi" }),
    ).toHaveAttribute("href", "/");
    expect(screen.queryByTestId("auth-flow")).not.toBeInTheDocument();
    expect(handBackMock).not.toHaveBeenCalled();
    expect(getOAuthClientPublicMock).not.toHaveBeenCalled();
    expect(getOAuthClientPublicPreloginMock).not.toHaveBeenCalled();
  });

  it("names the app a signed-in person came from when their request has expired", async () => {
    getSessionMock.mockResolvedValue({ session: { id: "session-1" } });
    getOAuthClientPublicMock.mockResolvedValue(
      ok({ client_name: "CMO", client_uri: "https://cmo.xyz" }),
    );

    await renderPage({
      ...OAUTH_SEARCH_PARAMS,
      exp: String(NOW / 1000 - 60),
    });

    expect(screen.getByRole("alert")).toHaveTextContent("errorTitleFor");
    expect(screen.getByRole("alert")).toHaveTextContent("errorDescriptionFor");
    expect(screen.getByRole("link", { name: "backTo" })).toHaveAttribute(
      "href",
      "https://cmo.xyz/",
    );
    expect(screen.queryByTestId("auth-flow")).not.toBeInTheDocument();
    expect(handBackMock).not.toHaveBeenCalled();
    expect(getOAuthClientPublicMock).toHaveBeenCalledOnce();
    expect(getOAuthClientPublicPreloginMock).not.toHaveBeenCalled();
  });

  it.each([ok(null), err({ reason: "http", status: 503 })])(
    "keeps the expired error generic when the session client lookup fails (%o)",
    async (result) => {
      getSessionMock.mockResolvedValue({ session: { id: "session-1" } });
      getOAuthClientPublicMock.mockResolvedValue(result);

      await renderPage({
        ...OAUTH_SEARCH_PARAMS,
        exp: String(NOW / 1000 - 60),
      });

      expect(screen.getByRole("alert")).toHaveTextContent("errorDescription");
      expect(
        screen.getByRole("link", { name: "backToSokosumi" }),
      ).toHaveAttribute("href", "/");
      expect(screen.queryByTestId("auth-flow")).not.toBeInTheDocument();
      expect(handBackMock).not.toHaveBeenCalled();
      expect(getOAuthClientPublicPreloginMock).not.toHaveBeenCalled();
    },
  );

  it.each([String(NOW / 1000 - 30), "soon"])(
    "leaves boundary or malformed expiry with the existing form (%s)",
    async (exp) => {
      getOAuthClientPublicPreloginMock.mockResolvedValue(null);

      await renderPage({ ...OAUTH_SEARCH_PARAMS, exp });

      expect(screen.getByTestId("auth-flow")).toBeInTheDocument();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      expect(handBackMock).not.toHaveBeenCalled();
      expect(getOAuthClientPublicMock).not.toHaveBeenCalled();
      expect(getOAuthClientPublicPreloginMock).toHaveBeenCalledOnce();
    },
  );

  it.each([
    {
      env: {
        NEXT_PUBLIC_NETWORK: "Preprod",
        NEXT_PUBLIC_VERCEL_GIT_COMMIT_REF: "",
        NEXT_PUBLIC_VERCEL_ENV: undefined,
      },
      cookie: "sokosumi-localhost-preprod.last_used_login_method",
    },
    {
      env: {
        NEXT_PUBLIC_NETWORK: "Preprod",
        NEXT_PUBLIC_VERCEL_GIT_COMMIT_REF: "feature/123",
        NEXT_PUBLIC_VERCEL_ENV: "preview",
      },
      cookie: "sokosumi-preview-preprod-feature-123.last_used_login_method",
    },
  ])("reads the last-login cookie $cookie", async ({ env, cookie }) => {
    getEnvPublicConfigMock.mockReturnValue(env);

    await renderPage();

    expect(getMock).toHaveBeenCalledWith(cookie);
  });

  it.each(["email", "google"] as const)(
    "opens the flow on the method this browser used last (%s)",
    async (method) => {
      getMock.mockReturnValue({ value: method });

      await renderPage();

      expect(authFlowMock).toHaveBeenCalledWith(
        expect.objectContaining({ lastUsedMethod: method }),
      );
    },
  );

  it("ignores a last-login cookie it does not know", async () => {
    getMock.mockReturnValue({ value: "magic-link" });

    await renderPage();

    expect(authFlowMock).toHaveBeenCalledWith(
      expect.objectContaining({ lastUsedMethod: null }),
    );
  });

  // The address never travels in the URL, which reaches logs and analytics.
  it("locks the address the invitation names, not one from the URL", async () => {
    getPendingInvitationMock.mockResolvedValue({
      invitation: { id: "inv_1", email: "invited@example.com" },
    });

    await renderPage({
      email: "someone-else@example.com",
      invitationId: "inv_1",
      returnUrl: "/accept-invitation/inv_1",
    });

    expect(getPendingInvitationMock).toHaveBeenCalledWith("inv_1");
    expect(authFlowMock).toHaveBeenCalledWith({
      mode,
      client: undefined,
      prefilledEmail: "invited@example.com",
      invitationId: "inv_1",
      returnUrl: "/accept-invitation/inv_1",
      lastUsedMethod: null,
    });
  });

  it.each([
    [
      "is gone",
      () => getPendingInvitationMock.mockResolvedValue({ error: "NOT_FOUND" }),
    ],
    [
      "cannot be read",
      () => {
        getPendingInvitationMock.mockRejectedValue(new Error("Core down"));
        vi.spyOn(console, "error").mockImplementation(() => undefined);
      },
    ],
  ])("locks no address when the invitation %s", async (_case, arrange) => {
    arrange();

    await renderPage({ invitationId: "inv_1" });

    expect(authFlowMock).toHaveBeenCalledWith(
      expect.objectContaining({ prefilledEmail: undefined }),
    );
  });

  it("says that creating an account accepts the terms", async () => {
    await renderPage();

    expect(screen.getByTestId("terms-notice")).toBeInTheDocument();
  });

  it("shows the product the person is continuing to", async () => {
    await renderPage(OAUTH_SEARCH_PARAMS);

    // Asked with the signed request: the person is not signed in yet.
    expect(getOAuthClientPublicPreloginMock).toHaveBeenCalledWith(
      "cmo",
      OAUTH_QUERY,
    );
    expect(authFlowMock).toHaveBeenCalledWith(
      expect.objectContaining({ client: CMO }),
    );
  });

  it("shows no product without an OAuth request", async () => {
    await renderPage();

    expect(getOAuthClientPublicPreloginMock).not.toHaveBeenCalled();
    expect(getSessionMock).not.toHaveBeenCalled();
    expect(authFlowMock).toHaveBeenCalledWith(
      expect.objectContaining({ client: undefined }),
    );
  });

  it("falls back to the plain header when the product cannot be loaded", async () => {
    getOAuthClientPublicPreloginMock.mockResolvedValue(null);

    await renderPage(OAUTH_SEARCH_PARAMS);

    expect(authFlowMock).toHaveBeenCalledWith(
      expect.objectContaining({ client: undefined }),
    );
    expect(screen.getByTestId("auth-flow")).toBeInTheDocument();
  });

  it("hands a signed-in person with an OAuth request back to the provider", async () => {
    getSessionMock.mockResolvedValue({ session: { id: "session-1" } });

    await renderPage(OAUTH_SEARCH_PARAMS);

    expect(handBackMock).toHaveBeenCalledWith({
      oauthQuery: OAUTH_QUERY,
      client: CMO,
    });
    expect(screen.queryByTestId("auth-flow")).not.toBeInTheDocument();
  });

  it("asks a signed-in person which account to use when the product asks for a new one", async () => {
    getSessionMock.mockResolvedValue({
      session: { id: "session-1" },
      user: { id: "user-1", name: "Ada Lovelace", email: "ada@example.com" },
    });

    await renderPage({ ...OAUTH_SEARCH_PARAMS, prompt: "create" });

    expect(handBackMock).toHaveBeenCalledWith({
      oauthQuery: `${OAUTH_QUERY}&prompt=create`,
      client: CMO,
      accountToConfirm: {
        id: "user-1",
        name: "Ada Lovelace",
        email: "ada@example.com",
      },
    });
    expect(screen.queryByTestId("auth-flow")).not.toBeInTheDocument();
  });

  it("asks even a session that started a moment before the request", async () => {
    getSessionMock.mockResolvedValue({
      session: {
        id: "session-1",
        createdAt: new Date(NOW - 300).toISOString(),
      },
      user: { id: "user-1", name: "Ada Lovelace", email: "ada@example.com" },
    });

    await renderPage({
      ...OAUTH_SEARCH_PARAMS,
      prompt: "create",
      // Signed 300 ms after the session started: the case the removed
      // `ba_iat` grace period answered without asking.
      ba_iat: String(NOW),
    });

    expect(handBackMock).toHaveBeenCalledWith(
      expect.objectContaining({
        accountToConfirm: {
          id: "user-1",
          name: "Ada Lovelace",
          email: "ada@example.com",
        },
      }),
    );
  });

  it("hands a new social sign-up back at once, without the new-account prompt", async () => {
    getSessionMock.mockResolvedValue({
      // Core sends a social sign-up here once to be counted, after its new
      // session answered "Create account".
      session: {
        id: "session-1",
        createdAt: new Date(NOW - 300).toISOString(),
      },
      user: { id: "user-1", name: "Ada Lovelace", email: "ada@example.com" },
    });

    await renderPage(OAUTH_SEARCH_PARAMS);

    expect(handBackMock).toHaveBeenCalledWith(
      expect.objectContaining({
        oauthQuery: OAUTH_QUERY,
        accountToConfirm: undefined,
      }),
    );
  });

  it("shows the form to a signed-out person when the product asks for a new account", async () => {
    await renderPage({ ...OAUTH_SEARCH_PARAMS, prompt: "create" });

    expect(handBackMock).not.toHaveBeenCalled();
    expect(screen.getByTestId("auth-flow")).toBeInTheDocument();
  });

  it("asks a signed-in person to sign in again when the request demands it", async () => {
    getSessionMock.mockResolvedValue({ session: { id: "session-1" } });

    await renderPage({ ...OAUTH_SEARCH_PARAMS, prompt: "login" });

    expect(handBackMock).not.toHaveBeenCalled();
    expect(screen.getByTestId("auth-flow")).toBeInTheDocument();
  });

  it.each([
    ["account_not_linked", "accountNotLinked"],
    ["access_denied", "cancelled"],
  ])(
    "explains why a sign-in brought the person back (%s)",
    async (error, message) => {
      await renderPage({ error });

      expect(screen.getByRole("alert")).toHaveTextContent(message);
    },
  );

  it("shows no error notice on a plain visit", async () => {
    await renderPage();

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
