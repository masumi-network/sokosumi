import { render, screen } from "@testing-library/react";
import { err, ok } from "neverthrow";
import { beforeEach, describe, expect, it, vi } from "vitest";
import englishMessages from "@/../messages/en.json";

const { getSessionMock, listUserAccountsMock } = vi.hoisted(() => ({
  getSessionMock: vi.fn(),
  listUserAccountsMock: vi.fn(),
}));

vi.mock("next-intl/server", () => ({
  getTranslations: async () => (key: string) => {
    const messages: Record<string, string> = {
      title: "Sign-in",
      description: "Use these accounts to sign in.",
      loadErrorTitle: englishMessages.App.Account.SocialAccounts.loadErrorTitle,
      loadError: englishMessages.App.Account.SocialAccounts.loadError,
      retry: englishMessages.App.Account.SocialAccounts.retry,
    };
    return messages[key] ?? key;
  },
}));

vi.mock("@/lib/auth/auth.server", () => ({
  getSession: getSessionMock,
  listUserAccounts: listUserAccountsMock,
}));

vi.mock("@/components/auth/core-auth-read-retry", () => ({
  CoreAuthReadRetry: ({
    title,
    description,
    retryLabel,
  }: {
    title: string;
    description: string;
    retryLabel: string;
  }) => (
    <div data-testid="connections-load-error">
      <h3>{title}</h3>
      <p>{description}</p>
      <button type="button">{retryLabel}</button>
    </div>
  ),
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

  it("shows a short next step when sign-in accounts fail to load", async () => {
    listUserAccountsMock.mockResolvedValue(
      err({ path: "/auth/list-accounts", reason: "http", status: 500 }),
    );

    render(await ConnectionsPage());

    expect(screen.getByTestId("connections-load-error")).toBeVisible();
    expect(screen.getByText("Could not load connected accounts")).toBeVisible();
    const description = screen.getByText(
      "Check your connection and try again.",
    );
    expect(description).toBeVisible();
    expect(description.textContent).toBe(
      "Check your connection and try again.",
    );
    expect(screen.getByRole("button", { name: "Retry" })).toBeVisible();
    expect(screen.queryByTestId("connections-social-accounts")).toBeNull();
  });
});
