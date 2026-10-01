import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import OAuthHandBack from "./oauth-hand-back";

const mockContinue = vi.fn();
const mockGetSession = vi.fn();
const mockSignOut =
  vi.fn<
    (
      userId: string,
      options: {
        fetchOptions: {
          body: { oauth_query: string };
          onSuccess: () => void;
          onError: (context: { error: unknown }) => void;
        };
      },
    ) => Promise<void>
  >();
const mockRefresh = vi.fn();
const mockToastError = vi.fn();
const mockClaimSignUpConversion = vi.fn();
const mockSignUpEvent = vi.fn();

vi.mock("@/lib/actions/auth/action", () => ({
  claimSignUpConversion: () => mockClaimSignUpConversion(),
}));

vi.mock("@/lib/gtm-events", () => ({
  fireGTMEvent: {
    signUp: (...args: unknown[]) => mockSignUpEvent(...args),
  },
}));

vi.mock("next-intl", () => ({
  useTranslations: () =>
    Object.assign(
      (key: string, values?: Record<string, string>) =>
        values ? `${key}:${Object.values(values).join(",")}` : key,
      {
        rich: (key: string, values: { email: string }) =>
          `${key}:${values.email}`,
      },
    ),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mockRefresh }),
}));

vi.mock("sonner", () => ({
  toast: { error: (...args: unknown[]) => mockToastError(...args) },
}));

vi.mock("@/lib/auth/sign-out.client", () => ({
  signOutWithPushRelease: (...args: Parameters<typeof mockSignOut>) =>
    mockSignOut(...args),
}));

vi.mock("@/lib/auth/auth.client", () => ({
  authClient: {
    getSession: (...args: unknown[]) => mockGetSession(...args),
    oauth2: {
      continue: (...args: unknown[]) => mockContinue(...args),
    },
  },
}));

const OAUTH_QUERY = "client_id=cmo&exp=1772367377&sig=signed";
const CMO = { name: "CMO", uri: "https://cmo.xyz/", logoUri: undefined };
const CREATE_QUERY = `${OAUTH_QUERY}&prompt=create`;
// Core signs a request for ten minutes; `exp` is in seconds.
const EXPIRES_AT = 1772367377 * 1000;
const BEFORE_EXPIRY = new Date(EXPIRES_AT - 5 * 60_000);
const ACCOUNT = {
  id: "user-1",
  name: "Ada Lovelace",
  email: "ada@example.com",
};

describe("OAuthHandBack", () => {
  beforeEach(() => {
    mockContinue.mockReset();
    mockGetSession.mockReset();
    mockGetSession.mockResolvedValue({ data: { user: ACCOUNT }, error: null });
    mockSignOut.mockReset();
    mockRefresh.mockReset();
    mockToastError.mockReset();
    mockClaimSignUpConversion.mockReset();
    mockClaimSignUpConversion.mockResolvedValue(null);
    mockSignUpEvent.mockReset();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(BEFORE_EXPIRY);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("hands the request back to the provider exactly once", async () => {
    mockContinue.mockResolvedValue({
      data: {
        redirect: true,
        url: "https://app.cmo.xyz/api/auth/callback/sokosumi?code=abc",
      },
      error: null,
    });

    // StrictMode mounts twice; a second hand-back would issue a second code.
    render(
      <StrictMode>
        <OAuthHandBack oauthQuery={OAUTH_QUERY} client={CMO} />
      </StrictMode>,
    );

    await waitFor(() => {
      expect(mockContinue).toHaveBeenCalledWith({
        created: true,
        oauth_query: OAUTH_QUERY,
      });
    });
    expect(mockContinue).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("status")).toHaveTextContent("continuingTo:CMO");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("counts a new social account once before handing the request back", async () => {
    mockClaimSignUpConversion.mockResolvedValue("google");
    mockContinue.mockResolvedValue({
      data: { redirect: true, url: "https://app.cmo.xyz/callback?code=abc" },
      error: null,
    });

    render(
      <StrictMode>
        <OAuthHandBack oauthQuery={OAUTH_QUERY} client={CMO} />
      </StrictMode>,
    );

    await waitFor(() => {
      expect(mockContinue).toHaveBeenCalledTimes(1);
    });
    expect(mockClaimSignUpConversion).toHaveBeenCalledTimes(1);
    expect(mockSignUpEvent).toHaveBeenCalledTimes(1);
    expect(mockSignUpEvent).toHaveBeenCalledWith("google");
    // The page leaves once the provider answers; the event must be out first.
    expect(mockSignUpEvent.mock.invocationCallOrder[0]).toBeLessThan(
      mockContinue.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it("counts nothing for an account that is not a new social sign-up", async () => {
    mockContinue.mockResolvedValue({
      data: { redirect: true, url: "https://app.cmo.xyz/callback?code=abc" },
      error: null,
    });

    render(<OAuthHandBack oauthQuery={OAUTH_QUERY} client={CMO} />);

    await waitFor(() => {
      expect(mockContinue).toHaveBeenCalledTimes(1);
    });
    expect(mockSignUpEvent).not.toHaveBeenCalled();
  });

  it("hands the request back even when the sign-up cannot be claimed", async () => {
    mockClaimSignUpConversion.mockRejectedValue(new Error("network"));
    mockContinue.mockResolvedValue({
      data: { redirect: true, url: "https://app.cmo.xyz/callback?code=abc" },
      error: null,
    });

    render(<OAuthHandBack oauthQuery={OAUTH_QUERY} client={CMO} />);

    await waitFor(() => {
      expect(mockContinue).toHaveBeenCalledTimes(1);
    });
    expect(mockSignUpEvent).not.toHaveBeenCalled();
  });

  it("stays on the page with an error when the provider refuses the request", async () => {
    mockContinue.mockResolvedValue({
      data: null,
      error: { status: 400, message: "invalid_signature" },
    });

    render(<OAuthHandBack oauthQuery={OAUTH_QUERY} client={CMO} />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "errorDescriptionFor:CMO",
    );
    // The request is dead; the way out is back to the product.
    expect(screen.getByRole("link", { name: "backTo:CMO" })).toHaveAttribute(
      "href",
      "https://cmo.xyz/",
    );
  });

  it("stays on the page with an error when the provider cannot be reached", async () => {
    mockContinue.mockRejectedValue(new Error("network"));

    render(<OAuthHandBack oauthQuery={OAUTH_QUERY} />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "errorDescription",
    );
  });

  describe("when the product asked for a new account", () => {
    it("asks which account to use instead of continuing", () => {
      render(
        <OAuthHandBack
          oauthQuery={CREATE_QUERY}
          client={CMO}
          accountToConfirm={ACCOUNT}
        />,
      );

      expect(mockContinue).not.toHaveBeenCalled();
      expect(
        screen.getByRole("heading", { name: "chooseAccountTitleFor:CMO" }),
      ).toBeInTheDocument();
      expect(
        screen.getByText("signedInAs:ada@example.com"),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "continueAs:Ada Lovelace" }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "useAnotherAccount" }),
      ).toBeInTheDocument();
    });

    it("offers the way back to the product instead of choosing", () => {
      render(
        <OAuthHandBack
          oauthQuery={CREATE_QUERY}
          client={CMO}
          accountToConfirm={ACCOUNT}
        />,
      );

      expect(screen.getByRole("link", { name: "backTo:CMO" })).toHaveAttribute(
        "href",
        "https://cmo.xyz/",
      );
      expect(mockContinue).not.toHaveBeenCalled();
    });

    it("hands the request back exactly once as the signed-in account", async () => {
      const user = userEvent.setup();
      mockContinue.mockResolvedValue({
        data: {
          redirect: true,
          url: "https://app.cmo.xyz/api/auth/callback/sokosumi?code=abc",
        },
        error: null,
      });
      render(
        <StrictMode>
          <OAuthHandBack
            oauthQuery={CREATE_QUERY}
            client={CMO}
            accountToConfirm={ACCOUNT}
          />
        </StrictMode>,
      );

      const continueButton = screen.getByRole("button", {
        name: "continueAs:Ada Lovelace",
      });
      await user.click(continueButton);
      await user.click(continueButton);

      expect(mockContinue).toHaveBeenCalledTimes(1);
      expect(mockContinue).toHaveBeenCalledWith({
        created: true,
        oauth_query: CREATE_QUERY,
      });
      expect(mockSignOut).not.toHaveBeenCalled();
      // It never navigates itself: Better Auth's client follows the answer.
      expect(mockRefresh).not.toHaveBeenCalled();
    });

    it.each(["continueAs:Ada Lovelace", "useAnotherAccount"])(
      "refreshes without changing auth when %s refers to a stale account",
      async (buttonName) => {
        mockGetSession.mockResolvedValue({
          data: { user: { ...ACCOUNT, id: "another-user" } },
          error: null,
        });
        render(
          <OAuthHandBack
            oauthQuery={CREATE_QUERY}
            accountToConfirm={ACCOUNT}
          />,
        );
        await userEvent
          .setup()
          .click(screen.getByRole("button", { name: buttonName }));
        await waitFor(() => expect(mockRefresh).toHaveBeenCalledOnce());
        expect(mockGetSession).toHaveBeenCalledWith({
          query: { disableCookieCache: true },
        });
        expect(mockContinue).not.toHaveBeenCalled();
        expect(mockSignOut).not.toHaveBeenCalled();
      },
    );

    it.each(["another-user", null])(
      "does not authorize a replaced session (%s) while the claim is pending",
      async (userId) => {
        let finishClaim = () => {};
        mockClaimSignUpConversion.mockReturnValue(
          new Promise<null>((resolve) => {
            finishClaim = () => resolve(null);
          }),
        );
        render(
          <OAuthHandBack
            oauthQuery={CREATE_QUERY}
            accountToConfirm={ACCOUNT}
          />,
        );
        await userEvent
          .setup()
          .click(
            screen.getByRole("button", { name: "continueAs:Ada Lovelace" }),
          );
        expect(mockClaimSignUpConversion).toHaveBeenCalledOnce();
        expect(mockContinue).not.toHaveBeenCalled();

        mockGetSession.mockResolvedValue({
          data: userId ? { user: { ...ACCOUNT, id: userId } } : null,
          error: null,
        });
        await act(async () => finishClaim());

        expect(mockRefresh).toHaveBeenCalledOnce();
        expect(mockContinue).not.toHaveBeenCalled();
        expect(mockSignOut).not.toHaveBeenCalled();
      },
    );

    it("allows retry when the account recheck after claiming fails", async () => {
      mockGetSession
        .mockResolvedValueOnce({ data: { user: ACCOUNT }, error: null })
        .mockRejectedValueOnce(new Error("offline"));
      mockContinue.mockResolvedValue({
        data: { redirect: true, url: "https://app.cmo.xyz/callback?code=abc" },
        error: null,
      });
      render(
        <OAuthHandBack oauthQuery={CREATE_QUERY} accountToConfirm={ACCOUNT} />,
      );
      const user = userEvent.setup();
      const button = screen.getByRole("button", {
        name: "continueAs:Ada Lovelace",
      });
      await user.click(button);
      await waitFor(() =>
        expect(mockToastError).toHaveBeenCalledWith("accountCheckError"),
      );
      expect(mockContinue).not.toHaveBeenCalled();
      expect(button).toBeEnabled();

      await user.click(button);
      await waitFor(() => expect(mockContinue).toHaveBeenCalledOnce());
    });

    it.each(["continueAs:Ada Lovelace", "useAnotherAccount"])(
      "allows retry when account validation fails before %s",
      async (buttonName) => {
        mockGetSession.mockRejectedValue(new Error("offline"));
        render(
          <OAuthHandBack
            oauthQuery={CREATE_QUERY}
            accountToConfirm={ACCOUNT}
          />,
        );
        await userEvent
          .setup()
          .click(screen.getByRole("button", { name: buttonName }));
        await waitFor(() =>
          expect(mockToastError).toHaveBeenCalledWith("accountCheckError"),
        );
        expect(screen.getByRole("button", { name: buttonName })).toBeEnabled();
        expect(mockContinue).not.toHaveBeenCalled();
        expect(mockSignOut).not.toHaveBeenCalled();
      },
    );

    it("does not sign out when account validation consumes the expiry margin", async () => {
      mockGetSession.mockImplementation(async () => {
        vi.setSystemTime(EXPIRES_AT - 60_000);
        return { data: { user: ACCOUNT }, error: null };
      });
      render(
        <OAuthHandBack oauthQuery={CREATE_QUERY} accountToConfirm={ACCOUNT} />,
      );
      await userEvent
        .setup()
        .click(screen.getByRole("button", { name: "useAnotherAccount" }));
      expect(await screen.findByRole("alert")).toBeInTheDocument();
      expect(mockSignOut).not.toHaveBeenCalled();
    });

    it("lets the person retry when sign-out rejects before a response", async () => {
      mockSignOut.mockRejectedValue(new Error("offline"));
      render(
        <OAuthHandBack oauthQuery={CREATE_QUERY} accountToConfirm={ACCOUNT} />,
      );
      await userEvent
        .setup()
        .click(screen.getByRole("button", { name: "useAnotherAccount" }));
      await waitFor(() =>
        expect(mockToastError).toHaveBeenCalledWith("signOutError"),
      );
      expect(
        screen.getByRole("button", { name: "useAnotherAccount" }),
      ).toBeEnabled();
      expect(mockRefresh).not.toHaveBeenCalled();
    });

    it("names the account by email when it has no name", () => {
      render(
        <OAuthHandBack
          oauthQuery={CREATE_QUERY}
          accountToConfirm={{ ...ACCOUNT, name: " " }}
        />,
      );

      expect(
        screen.getByRole("heading", { name: "chooseAccountTitle" }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "continueAs:ada@example.com" }),
      ).toBeInTheDocument();
    });

    it("shows the error when the provider refuses the request", async () => {
      const user = userEvent.setup();
      mockContinue.mockResolvedValue({
        data: null,
        error: { status: 400, message: "invalid_signature" },
      });
      render(
        <OAuthHandBack
          oauthQuery={CREATE_QUERY}
          client={CMO}
          accountToConfirm={ACCOUNT}
        />,
      );

      await user.click(
        screen.getByRole("button", { name: "continueAs:Ada Lovelace" }),
      );

      expect(await screen.findByRole("alert")).toHaveTextContent(
        "errorDescriptionFor:CMO",
      );
    });

    it("signs out of Sokosumi and shows the form again for another account", async () => {
      const user = userEvent.setup();
      mockSignOut.mockImplementation(async (_userId, options) => {
        options.fetchOptions.onSuccess();
      });
      render(
        <OAuthHandBack
          oauthQuery={CREATE_QUERY}
          client={CMO}
          accountToConfirm={ACCOUNT}
        />,
      );

      await user.click(
        screen.getByRole("button", { name: "useAnotherAccount" }),
      );

      expect(mockSignOut).toHaveBeenCalledWith("user-1", {
        fetchOptions: expect.objectContaining({
          body: { oauth_query: CREATE_QUERY },
        }),
      });
      // The page renders again with the same signed request, now signed out.
      await waitFor(() => {
        expect(mockRefresh).toHaveBeenCalledTimes(1);
      });
      expect(mockContinue).not.toHaveBeenCalled();
    });

    it.each([
      ["has expired", EXPIRES_AT + 1000],
      ["has too little time left for another sign-in", EXPIRES_AT - 60_000],
    ])("keeps the person signed in when the request %s", async (_when, now) => {
      const user = userEvent.setup();
      vi.setSystemTime(now);
      render(
        <OAuthHandBack
          oauthQuery={CREATE_QUERY}
          client={CMO}
          accountToConfirm={ACCOUNT}
        />,
      );

      await user.click(
        screen.getByRole("button", { name: "useAnotherAccount" }),
      );

      // The form could not use the request; signing out would gain nothing.
      expect(screen.getByRole("alert")).toHaveTextContent(
        "errorDescriptionFor:CMO",
      );
      expect(mockSignOut).not.toHaveBeenCalled();
      expect(mockRefresh).not.toHaveBeenCalled();
    });

    it("shows the expiry error when Core refuses the request on sign-out", async () => {
      const user = userEvent.setup();
      // Core, not this browser's clock, decides the request has expired.
      mockSignOut.mockImplementation(async (_userId, options) => {
        options.fetchOptions.onError({
          error: { status: 400, error: "invalid_signature" },
        });
      });
      render(
        <OAuthHandBack
          oauthQuery={CREATE_QUERY}
          client={CMO}
          accountToConfirm={ACCOUNT}
        />,
      );

      await user.click(
        screen.getByRole("button", { name: "useAnotherAccount" }),
      );

      expect(await screen.findByRole("alert")).toHaveTextContent(
        "errorDescriptionFor:CMO",
      );
      expect(mockToastError).not.toHaveBeenCalled();
      expect(mockRefresh).not.toHaveBeenCalled();
    });

    it("lets the person choose again when signing out fails", async () => {
      const user = userEvent.setup();
      mockSignOut.mockImplementation(async (_userId, options) => {
        options.fetchOptions.onError({
          error: { status: 500, error: "unavailable" },
        });
      });
      render(
        <OAuthHandBack
          oauthQuery={CREATE_QUERY}
          client={CMO}
          accountToConfirm={ACCOUNT}
        />,
      );

      await user.click(
        screen.getByRole("button", { name: "useAnotherAccount" }),
      );

      await waitFor(() => {
        expect(mockToastError).toHaveBeenCalledWith("signOutError");
      });
      expect(mockRefresh).not.toHaveBeenCalled();
      expect(
        screen.getByRole("button", { name: "useAnotherAccount" }),
      ).toBeEnabled();
      expect(
        screen.getByRole("button", { name: "continueAs:Ada Lovelace" }),
      ).toBeEnabled();
    });
  });

  it.each([
    undefined,
    { name: "CMO", uri: undefined, logoUri: undefined },
    { name: "CMO", uri: undefined, logoUri: "https://cmo.xyz/logo.png" },
  ])(
    "offers an exit from a failed request without a client home (%o)",
    async (client) => {
      mockContinue.mockResolvedValue({
        data: null,
        error: { status: 400, message: "invalid_signature" },
      });

      render(<OAuthHandBack oauthQuery={OAUTH_QUERY} client={client} />);

      await screen.findByRole("alert");
      expect(
        screen.getByRole("link", { name: "backToSokosumi" }),
      ).toHaveAttribute("href", "/");
      expect(mockContinue).toHaveBeenCalledTimes(1);
    },
  );
});
