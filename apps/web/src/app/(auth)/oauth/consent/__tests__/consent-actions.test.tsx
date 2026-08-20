import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ConsentActions } from "../consent-actions";

const mockConsent = vi.hoisted(() => vi.fn());

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
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
    mockConsent.mockResolvedValue({
      data: null,
      error: { message: "Expected test error" },
    });
  });

  it("submits the canonical signed query when authorizing", async () => {
    render(<ConsentActions oauthQuery={oauthQuery} />);

    fireEvent.click(screen.getByRole("button", { name: "authorize" }));

    await waitFor(() => {
      expect(mockConsent).toHaveBeenCalledWith({
        accept: true,
        oauth_query: oauthQuery,
      });
    });
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
  });
});
