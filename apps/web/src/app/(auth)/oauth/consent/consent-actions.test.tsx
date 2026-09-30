import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ConsentActions } from "./consent-actions";

const mockConsent = vi.hoisted(() => vi.fn());
const mockEnsureOAuthWorkspaceAction = vi.hoisted(() => vi.fn());
const mockToastError = vi.hoisted(() => vi.fn());

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("sonner", () => ({
  toast: {
    error: mockToastError,
    success: vi.fn(),
  },
}));

vi.mock("@/lib/actions/workspace-gate/action", () => ({
  ensureOAuthWorkspaceAction: mockEnsureOAuthWorkspaceAction,
}));

vi.mock("@/lib/auth/auth.client", () => ({
  authClient: {
    oauth2: {
      consent: mockConsent,
    },
  },
}));

describe("ConsentActions", () => {
  const oauthQuery = "client_id=client_1&exp=1772367377&sig=abc%2Bdef%2Fghi%3D";

  beforeEach(() => {
    mockConsent.mockReset();
    mockEnsureOAuthWorkspaceAction.mockReset();
    mockToastError.mockReset();
    mockEnsureOAuthWorkspaceAction.mockResolvedValue({
      ok: true,
      value: { createdPersonalWorkspace: false },
    });
    mockConsent.mockResolvedValue({
      data: null,
      error: { message: "Expected test error" },
    });
  });

  it("submits the canonical signed query when authorizing", async () => {
    render(<ConsentActions oauthQuery={oauthQuery} />);

    fireEvent.click(screen.getByRole("button", { name: "authorize" }));

    await waitFor(() => {
      expect(mockEnsureOAuthWorkspaceAction).toHaveBeenCalledWith({});
      expect(mockConsent).toHaveBeenCalledWith({
        accept: true,
        oauth_query: oauthQuery,
      });
    });
    expect(
      mockEnsureOAuthWorkspaceAction.mock.invocationCallOrder[0],
    ).toBeLessThan(mockConsent.mock.invocationCallOrder[0]);
  });

  it("does not authorize when workspace preparation fails", async () => {
    mockEnsureOAuthWorkspaceAction.mockResolvedValue({
      ok: false,
      error: { code: "INTERNAL", message: "Core unavailable" },
    });
    render(<ConsentActions oauthQuery={oauthQuery} />);

    fireEvent.click(screen.getByRole("button", { name: "authorize" }));

    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalledWith("workspacePrepareError");
    });
    expect(mockConsent).not.toHaveBeenCalled();
  });

  it("re-enables Deny with a message when the consent call throws", async () => {
    mockConsent.mockRejectedValue(new Error("network down"));
    render(<ConsentActions oauthQuery={oauthQuery} />);

    fireEvent.click(screen.getByRole("button", { name: "deny" }));

    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalledWith("denyError");
    });
    expect(screen.getByRole("button", { name: "deny" })).toBeEnabled();
  });

  it("submits the canonical signed query when denying", async () => {
    render(<ConsentActions oauthQuery={oauthQuery} />);

    fireEvent.click(screen.getByRole("button", { name: "deny" }));

    await waitFor(() => {
      expect(mockConsent).toHaveBeenCalledWith({
        accept: false,
        oauth_query: oauthQuery,
      });
    });
    expect(mockEnsureOAuthWorkspaceAction).not.toHaveBeenCalled();
  });
  describe("after the consent answer", () => {
    const callbackUrl =
      "https://app.cmo.xyz/api/auth/callback/sokosumi?code=abc";
    const originalLocation = window.location;
    const navigations: string[] = [];

    beforeEach(() => {
      navigations.length = 0;
      Object.defineProperty(window, "location", {
        configurable: true,
        value: {
          get href() {
            return "http://localhost/oauth/consent";
          },
          set href(url: string) {
            navigations.push(url);
          },
        },
      });
    });

    afterEach(() => {
      Object.defineProperty(window, "location", {
        configurable: true,
        value: originalLocation,
      });
    });

    // Better Auth's client already follows `{ redirect: true, url }`. A second
    // navigation sends the code twice; a confidential client such as CMO then
    // exchanges it twice and Core revokes the first exchange's tokens.
    it.each(["authorize", "deny"])(
      "leaves the redirect after %s to Better Auth's client",
      async (name) => {
        mockConsent.mockResolvedValue({
          data: { redirect: true, url: callbackUrl },
          error: null,
        });
        render(<ConsentActions oauthQuery={oauthQuery} />);

        fireEvent.click(screen.getByRole("button", { name }));
        await waitFor(() => expect(mockConsent).toHaveBeenCalled());
        await new Promise((resolve) => setTimeout(resolve, 400));

        expect(navigations).toEqual([]);
      },
    );

    it("goes home when an authorized consent has nowhere to return", async () => {
      mockConsent.mockResolvedValue({
        data: { redirect: false },
        error: null,
      });
      render(<ConsentActions oauthQuery={oauthQuery} />);

      fireEvent.click(screen.getByRole("button", { name: "authorize" }));

      await waitFor(() => expect(navigations).toEqual(["/"]));
    });
  });
});
