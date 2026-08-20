import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ConsentActions } from "../consent-actions";

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

vi.mock("@/lib/actions/workspace-gate", () => ({
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
});
