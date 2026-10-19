import { render, screen } from "@testing-library/react";
import { ok } from "neverthrow";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getSessionMock, listUserAccountsMock } = vi.hoisted(() => ({
  getSessionMock: vi.fn(),
  listUserAccountsMock: vi.fn(),
}));

vi.mock("next-intl/server", () => ({
  getTranslations: async () => (key: string) => {
    const messages: Record<string, string> = {
      title: "Sign-in",
      description: "Use these accounts to sign in.",
      loadErrorTitle: "Could not load connected accounts",
      loadError: "Could not load connected accounts.",
      retry: "Retry",
    };
    return messages[key] ?? key;
  },
}));

vi.mock("@/lib/auth/auth.server", () => ({
  getSession: getSessionMock,
  listUserAccounts: listUserAccountsMock,
}));

vi.mock("@/components/auth/core-auth-read-retry", () => ({
  CoreAuthReadRetry: () => <div data-testid="connections-load-error" />,
}));

vi.mock("./social-accounts", () => ({
  SocialAccounts: () => <div data-testid="connections-social-accounts" />,
}));

vi.mock("./connections-tabs", () => ({
  ConnectionsTabs: () => <div data-testid="connections-tabs" />,
}));

vi.mock("./authorized-clients", () => ({
  OAuthAuthorizedClients: () => null,
}));

vi.mock("./mcp-active-key-view", () => ({
  McpActiveKeyView: () => null,
}));

import { ConnectionsPage } from "./connections-page";

describe("ConnectionsPage", () => {
  beforeEach(() => {
    getSessionMock.mockReset();
    listUserAccountsMock.mockReset();
    getSessionMock.mockResolvedValue({ user: { id: "user-1" } });
    listUserAccountsMock.mockResolvedValue(ok([]));
  });

  it("titles the sign-in providers above the account rows", async () => {
    render(await ConnectionsPage());

    const section = screen.getByTestId("connections-sign-in");
    expect(
      screen.getByRole("heading", { level: 2, name: "Sign-in" }),
    ).toBeVisible();
    expect(screen.getByText("Use these accounts to sign in.")).toBeVisible();
    expect(section).toContainElement(
      screen.getByTestId("connections-social-accounts"),
    );
  });
});
