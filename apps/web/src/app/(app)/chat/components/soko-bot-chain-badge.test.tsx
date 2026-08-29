import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it } from "vitest";

import messages from "@/../messages/en.json";

import { SokoBotChainBadge } from "./soko-bot-chain-badge";

function renderBadge(metadata: unknown) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <SokoBotChainBadge metadata={metadata} />
    </NextIntlClientProvider>,
  );
}

describe("SokoBotChainBadge", () => {
  it("shows how far an assistant-to-assistant exchange has run", () => {
    renderBadge({
      soko_bot_chain: {
        depth: 2,
        max_depth: 4,
        room_messages_this_hour: 6,
        room_messages_per_hour: 20,
      },
    });

    expect(screen.getByTestId("soko-bot-chain-badge")).toHaveTextContent("2/4");
  });

  it("stays out of the way of ordinary messages", () => {
    // Human messages and a bot's reply to its owner carry no chain metadata,
    // so the badge must not appear on the overwhelming majority of rows.
    renderBadge({ soko_bot: { turn_id: "turn_1" } });

    expect(screen.queryByTestId("soko-bot-chain-badge")).toBeNull();
  });

  it("ignores metadata missing any of the counters", () => {
    renderBadge({ soko_bot_chain: { depth: 1 } });

    expect(screen.queryByTestId("soko-bot-chain-badge")).toBeNull();
  });
});
