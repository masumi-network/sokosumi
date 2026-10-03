import { render, screen } from "@testing-library/react";
import { err, ok } from "neverthrow";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const cookiesMock = vi.fn();
const getMock = vi.fn();
const signUpFlowMock = vi.fn();
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

describe("SignUp page", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"], now: NOW });
    vi.clearAllMocks();
    getMock.mockReturnValue({ value: "email-otp" });
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
    expect(screen.queryByTestId("sign-up-flow")).not.toBeInTheDocument();
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
    expect(screen.queryByTestId("sign-up-flow")).not.toBeInTheDocument();
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
      expect(screen.queryByTestId("sign-up-flow")).not.toBeInTheDocument();
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
      expect(screen.getByTestId("sign-up-flow")).toBeInTheDocument();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      expect(handBackMock).not.toHaveBeenCalled();
      expect(getOAuthClientPublicMock).not.toHaveBeenCalled();
      expect(getOAuthClientPublicPreloginMock).toHaveBeenCalledOnce();
    },
  );

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
    getPendingInvitationMock.mockResolvedValue({
      invitation: { id: "inv_1", email: "ada@example.com" },
    });
    const { default: Page } = await import("./page");

    render(
      await Page({
        searchParams: Promise.resolve({
          email: "someone-else@example.com",
          invitationId: "inv_1",
          returnUrl: "/agents",
        }),
      }),
    );

    expect(signUpFlowMock).toHaveBeenCalledWith({
      invitationId: "inv_1",
      client: undefined,
      prefilledEmail: "ada@example.com",
      returnUrl: "/agents",
      lastUsedMethod: "google",
    });
  });

  it("signs up without a lock when the invitation is gone", async () => {
    getPendingInvitationMock.mockResolvedValue({ error: "NOT_FOUND" });
    const { default: Page } = await import("./page");

    render(
      await Page({
        searchParams: Promise.resolve({ invitationId: "inv_1" }),
      }),
    );

    expect(signUpFlowMock).toHaveBeenCalledWith(
      expect.objectContaining({ prefilledEmail: undefined }),
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
    expect(signUpFlowMock).toHaveBeenCalledWith(
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
    expect(signUpFlowMock).toHaveBeenCalledWith(
      expect.objectContaining({ client: undefined }),
    );
  });

  it("falls back to the plain header when the product cannot be loaded", async () => {
    getOAuthClientPublicPreloginMock.mockResolvedValue(null);
    const { default: Page } = await import("./page");

    render(await Page({ searchParams: Promise.resolve(OAUTH_SEARCH_PARAMS) }));

    expect(signUpFlowMock).toHaveBeenCalledWith(
      expect.objectContaining({ client: undefined }),
    );
    expect(screen.getByTestId("sign-up-flow")).toBeInTheDocument();
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
    expect(screen.queryByTestId("sign-up-flow")).not.toBeInTheDocument();
  });

  it("asks a signed-in person which account to use when the product asks for a new one", async () => {
    getSessionMock.mockResolvedValue({
      // Signed in an hour before the product sent the request.
      session: { id: "session-1", createdAt: "2026-09-30T09:00:00.000Z" },
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
    expect(screen.queryByTestId("sign-up-flow")).not.toBeInTheDocument();
  });

  it("asks even a session that started a moment before the request", async () => {
    getSessionMock.mockResolvedValue({
      session: {
        id: "session-1",
        createdAt: new Date(NOW - 300).toISOString(),
      },
      user: { id: "user-1", name: "Ada Lovelace", email: "ada@example.com" },
    });
    const { default: Page } = await import("./page");

    render(
      await Page({
        searchParams: Promise.resolve({
          ...OAUTH_SEARCH_PARAMS,
          prompt: "create",
          // Core signed it (`ba_iat`, milliseconds) as the session started.
          ba_iat: String(NOW),
        }),
      }),
    );

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
    const { default: Page } = await import("./page");

    render(await Page({ searchParams: Promise.resolve(OAUTH_SEARCH_PARAMS) }));

    expect(handBackMock).toHaveBeenCalledWith(
      expect.objectContaining({
        oauthQuery: OAUTH_QUERY,
        accountToConfirm: undefined,
      }),
    );
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
