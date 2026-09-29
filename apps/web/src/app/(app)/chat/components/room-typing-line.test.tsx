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

    const line = screen.getByTestId("room-typing-line");
    expect(line).toHaveAttribute("aria-live", "polite");
    // The whole sentence, not the diff: "and Andreas are typing" alone is
    // not a thing anyone wants read out.
    expect(line).toHaveAttribute("aria-atomic", "true");
  });

  it("keeps one live region that is always present, empty or not", () => {
    // A live region mounted together with its text usually fails to announce,
    // so the node stays and only its text changes (ADR-0033).
    const { rerender } = renderLine([]);
    const empty = screen.getByTestId("room-typing-line");
    expect(empty).toHaveAttribute("aria-live", "polite");

    rerender(
      <NextIntlClientProvider locale="en" messages={messages}>
        <RoomTypingLine typistIds={["user_pat"]} usersById={USERS} />
      </NextIntlClientProvider>,
    );

    expect(screen.getAllByTestId("room-typing-line")).toHaveLength(1);
    expect(screen.getByTestId("room-typing-line")).toHaveTextContent(
      "Patrick Tobin is typing",
    );
  });

  it("is a row on narrow layouts and sits in the composer's pad from md up", () => {
    renderLine(["user_pat"]);

    const line = screen.getByTestId("room-typing-line");
    // Narrow: an ordinary row that holds its height.
    expect(line.className).toContain("min-h-5");
    // md and up: out of flow, in padding the form already has. The box drops
    // to its natural text height there — at 20px it would reach up into the
    // composer card, which has only 24px of pad beneath it.
    expect(line.className).toContain("md:absolute");
    expect(line.className).toContain("md:bottom-1");
    expect(line.className).toContain("md:min-h-0");
  });
});
