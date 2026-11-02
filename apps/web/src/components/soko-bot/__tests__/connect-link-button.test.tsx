import { fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";

import Markdown from "@/components/markdown";
import { connectLinkTarget } from "@/components/soko-bot/connect-link-button";

import messages from "../../../../messages/en.json";

const start = vi.hoisted(() => vi.fn());
vi.mock("@/lib/soko-bot/start-integration-connect", () => ({
  startSokoBotConnect: start,
}));

beforeEach(() => {
  start.mockReset().mockResolvedValue(null);
});

describe("connectLinkTarget", () => {
  it.each([
    [
      "/personal-assistant?connect=hubspot",
      { provider: "hubspot", botId: null },
    ],
    ["/soko-bots/bot-1?connect=notion", { provider: "notion", botId: "bot-1" }],
    ["/personal-assistant", null],
    ["/projects/p1?connect=hubspot", null],
    ["https://evil.example/personal-assistant?connect=hubspot", null],
    ["/personal-assistant?connect=..%2Fx", null],
  ])("%s", (href, expected) => {
    expect(connectLinkTarget(href)).toEqual(expected);
  });
});

describe("a connect link in a message", () => {
  it("is a button that starts the sign-in and comes back here", async () => {
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <Markdown>
          {"[Connect HubSpot](/personal-assistant?connect=hubspot), then ask."}
        </Markdown>
      </NextIntlClientProvider>,
    );

    expect(screen.queryByRole("link")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Connect HubSpot" }));

    expect(start).toHaveBeenCalledWith("hubspot", {
      botId: null,
      returnTo: "/",
    });
  });
});
