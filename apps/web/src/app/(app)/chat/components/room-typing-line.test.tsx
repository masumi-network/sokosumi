import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it } from "vitest";

import messages from "@/../messages/en.json";

import { RoomTypingLine } from "./room-typing-line";

const USERS = new Map([
  ["user_pat", { id: "user_pat", name: "Patrick Tobin" }],
  ["user_andreas", { id: "user_andreas", name: "Andreas Osberghaus" }],
  ["user_kim", { id: "user_kim", name: "Kim Ferrari" }],
  ["user_nameless", { id: "user_nameless", name: "  " }],
]);

function renderLine(typistIds: readonly string[]) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <RoomTypingLine typistIds={typistIds} usersById={USERS} />
    </NextIntlClientProvider>,
  );
}

describe("RoomTypingLine", () => {
  it("names one typist", () => {
    renderLine(["user_pat"]);

    expect(screen.getByTestId("room-typing-line")).toHaveTextContent(
      "Patrick Tobin is typing",
    );
  });

  it("names two typists in the order they started", () => {
    renderLine(["user_pat", "user_andreas"]);

    expect(screen.getByTestId("room-typing-line")).toHaveTextContent(
      "Patrick Tobin and Andreas Osberghaus are typing",
    );
  });

  it("stops naming people past two", () => {
    renderLine(["user_pat", "user_andreas", "user_kim"]);

    const line = screen.getByTestId("room-typing-line");
    expect(line).toHaveTextContent("Several people are typing");
    expect(line).not.toHaveTextContent("Patrick");
  });

  it("holds its space in a quiet room so the composer never moves", () => {
    renderLine([]);

    const line = screen.getByTestId("room-typing-line");
    expect(line).toBeInTheDocument();
    expect(line).toHaveTextContent("");
  });

  it("drops a typist it cannot name rather than showing a placeholder", () => {
    renderLine(["user_nameless"]);

    expect(screen.getByTestId("room-typing-line")).toHaveTextContent("");
  });

  it("drops an unknown typist but still names the ones it knows", () => {
    renderLine(["user_pat", "user_ghost"]);

    expect(screen.getByTestId("room-typing-line")).toHaveTextContent(
      "Patrick Tobin is typing",
    );
  });

  it("announces changes politely rather than interrupting a screen reader", () => {
    renderLine(["user_pat"]);

    expect(screen.getByTestId("room-typing-line")).toHaveAttribute(
      "aria-live",
      "polite",
    );
  });
});
