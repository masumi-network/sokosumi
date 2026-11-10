import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { OAuthAuthorizedClients } from "./authorized-clients";

const mockGetConsents = vi.fn();
const mockPublicClient = vi.fn();

// Stable like next-intl's own `t`: the component refetches when `t` changes.
const t = (key: string) => key;

vi.mock("next-intl", () => ({
  useFormatter: () => ({ dateTime: () => "Feb 10, 2026" }),
  useTranslations: () => t,
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

vi.mock("@/lib/actions/oauth/action", () => ({
  revokeOAuthClientAccess: vi.fn(),
}));

vi.mock("@/lib/auth/auth.client", () => ({
  authClient: {
    oauth2: {
      getConsents: (...args: unknown[]) => mockGetConsents(...args),
      publicClient: (...args: unknown[]) => mockPublicClient(...args),
    },
  },
}));

describe("OAuthAuthorizedClients", () => {
  beforeEach(() => {
    mockGetConsents.mockReset();
    mockGetConsents.mockResolvedValue({
      data: [
        {
          id: "consent-1",
          clientId: "client-1",
          createdAt: "2026-02-10T00:00:00.000Z",
        },
      ],
      error: null,
    });
    mockPublicClient.mockReset();
    mockPublicClient.mockResolvedValue({
      data: { client_name: "Claude" },
      error: null,
    });
  });

  it("names an app the viewer authorized but does not own", async () => {
    render(<OAuthAuthorizedClients />);

    expect(await screen.findByText("Claude")).toBeInTheDocument();
    expect(screen.queryByText("client-1")).not.toBeInTheDocument();
    expect(mockPublicClient).toHaveBeenCalledWith({
      query: { client_id: "client-1" },
    });
  });

  it("falls back to the client id when the name cannot be loaded", async () => {
    mockPublicClient.mockRejectedValue(new Error("not found"));
    render(<OAuthAuthorizedClients />);

    expect(await screen.findByText("client-1")).toBeInTheDocument();
  });
});
