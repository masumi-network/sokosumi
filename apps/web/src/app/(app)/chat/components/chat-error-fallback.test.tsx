import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it } from "vitest";

import messages from "@/../messages/en.json";

import { ChatErrorFallback } from "./chat-error-fallback";

function renderFallback(roomId?: string | null) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <ChatErrorFallback roomId={roomId} />
    </NextIntlClientProvider>,
  );
}

describe("ChatErrorFallback", () => {
  // The fallback renders *inside* the boundary that already caught one throw.
  // A missing message key here would throw again with nothing left to catch
  // it, turning a broken room into a blank page, so it is pinned against the
  // real en.json rather than a stub.
  it("names the room the report is filed under", () => {
    renderFallback("01a0016b-68b2-71cb-b1c5-f7406d573625");

    expect(
      screen.getByText(/01a0016b-68b2-71cb-b1c5-f7406d573625/),
    ).toBeInTheDocument();
  });

  it("still explains itself off a room page, where there is no room to name", () => {
    renderFallback(null);

    expect(
      screen.getByText(messages.App.Chat.Chat.chatErrorTitle),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Reference: room/)).not.toBeInTheDocument();
  });
});
