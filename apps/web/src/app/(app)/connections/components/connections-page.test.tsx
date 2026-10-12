import { render, screen } from "@testing-library/react";
import { err } from "neverthrow";
import { beforeEach, describe, expect, it, vi } from "vitest";
import messages from "@/../messages/en.json";

const getSessionMock = vi.fn();
const listUserAccountsMock = vi.fn();

vi.mock("next-intl/server", () => ({
  getTranslations:
    async () => (key: keyof typeof messages.App.Account.SocialAccounts) =>
      messages.App.Account.SocialAccounts[key],
}));

vi.mock("@/lib/auth/auth.server", () => ({
  getSession: () => getSessionMock(),
  listUserAccounts: () => listUserAccountsMock(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

vi.mock("./social-accounts", () => ({
  SocialAccounts: () => <div data-testid="social-accounts" />,
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

describe("ConnectionsPage", () => {
  beforeEach(() => {
    getSessionMock.mockReset();
    listUserAccountsMock.mockReset();
  });

  it("shows a short next step when sign-in accounts fail to load", async () => {
    getSessionMock.mockResolvedValue({ user: { id: "user-1" } });
    listUserAccountsMock.mockResolvedValue(
      err({ path: "/auth/list-accounts", reason: "http", status: 500 }),
    );

    const { ConnectionsPage } = await import("./connections-page");
    render(await ConnectionsPage());

    expect(screen.getByText("Could not load connected accounts")).toBeVisible();
    expect(
      screen.getByText("Check your connection and try again."),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Retry" })).toBeVisible();
    expect(screen.queryByTestId("social-accounts")).toBeNull();
  });
});
