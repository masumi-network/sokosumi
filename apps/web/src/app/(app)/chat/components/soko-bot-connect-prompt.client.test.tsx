import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { connectSokoBotIntegrationAction } from "@/lib/actions/soko-bot/action";
import { COMPOSIO_BOT_ID_STORAGE_KEY } from "@/lib/composio/oauth-popup-protocol";

import {
  SokoBotConnectCard,
  SokoBotConnectPrompt,
} from "./soko-bot-connect-prompt.client";

const prompt = {
  botId: "bot-1",
  botName: "Joseph",
  offers: [{ provider: "gmail", name: "Gmail", connected: false }],
};

vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: prompt }),
}));
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: { name?: string }) =>
    values?.name ? `${key}:${values.name}` : key,
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));
vi.mock("@/lib/actions/soko-bot/action", () => ({
  connectSokoBotIntegrationAction: vi.fn(async () => ({
    ok: false,
    error: { message: "not in tests" },
  })),
}));

describe("SokoBotConnectPrompt", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.mocked(connectSokoBotIntegrationAction).mockClear();
  });

  it("stays dismissed for that bot after a remount", async () => {
    const { unmount } = render(<SokoBotConnectPrompt sokoBotId="bot-1" />);
    await userEvent.click(
      screen.getByRole("button", { name: "connectDismiss" }),
    );
    expect(screen.queryByTestId("soko-bot-connect-prompt")).toBeNull();
    unmount();

    render(<SokoBotConnectPrompt sokoBotId="bot-1" />);
    expect(screen.queryByTestId("soko-bot-connect-prompt")).toBeNull();
  });

  it("starts a connection only for a provider not yet connected", async () => {
    render(
      <SokoBotConnectCard
        botName="Joseph"
        offers={[
          { provider: "gmail", name: "Gmail", connected: true },
          { provider: "outlook", name: "Outlook", connected: false },
        ]}
        onDismiss={() => {}}
      />,
    );

    await userEvent.click(
      screen.getByRole("button", { name: "connectConnected:Gmail" }),
    );
    expect(connectSokoBotIntegrationAction).not.toHaveBeenCalled();

    await userEvent.click(
      screen.getByRole("button", { name: "connectProvider:Outlook" }),
    );
    expect(connectSokoBotIntegrationAction).toHaveBeenCalledWith(
      expect.objectContaining({ provider: "outlook" }),
    );
  });

  it("clears a shared bot left by an abandoned connect, so the DM connects the caller's own bot", async () => {
    window.sessionStorage.setItem(
      COMPOSIO_BOT_ID_STORAGE_KEY,
      "8a7f2c1e-4b3d-4e5f-9a8b-1c2d3e4f5a6b",
    );
    vi.mocked(connectSokoBotIntegrationAction).mockResolvedValueOnce({
      ok: true,
      value: { redirectUrl: "https://composio.example/connect" },
    });
    const assign = vi.fn();
    vi.stubGlobal("location", { origin: "https://app.test", assign });
    try {
      render(
        <SokoBotConnectCard
          botName="Joseph"
          offers={[{ provider: "gmail", name: "Gmail", connected: false }]}
          onDismiss={() => {}}
        />,
      );
      await userEvent.click(
        screen.getByRole("button", { name: "connectProvider:Gmail" }),
      );
      await waitFor(() =>
        expect(assign).toHaveBeenCalledWith("https://composio.example/connect"),
      );
      expect(connectSokoBotIntegrationAction).toHaveBeenCalledWith({
        provider: "gmail",
        returnUrl:
          "https://app.test/personal-assistant/integrations/return?provider=gmail",
        botId: undefined,
      });
      expect(
        window.sessionStorage.getItem(COMPOSIO_BOT_ID_STORAGE_KEY),
      ).toBeNull();
    } finally {
      vi.unstubAllGlobals();
      window.sessionStorage.clear();
    }
  });
});
