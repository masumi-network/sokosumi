import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { connectSokoBotIntegrationAction } from "@/lib/actions/soko-bot/action";

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
});
