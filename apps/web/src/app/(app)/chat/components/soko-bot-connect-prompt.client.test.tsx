import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SokoBotConnectPrompt } from "./soko-bot-connect-prompt.client";

const prompt = {
  botId: "bot-1",
  botName: "Joseph",
  offers: [{ provider: "gmail", name: "Gmail", connected: false }],
};

vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: prompt }),
}));
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));
vi.mock("nuqs", () => ({
  parseAsString: {},
  useQueryState: () => ["current", vi.fn()],
}));
vi.mock("@/lib/actions/soko-bot/action", () => ({
  connectSokoBotIntegrationAction: vi.fn(),
}));

describe("SokoBotConnectPrompt", () => {
  beforeEach(() => window.localStorage.clear());

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
});
