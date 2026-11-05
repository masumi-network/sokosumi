import { render, screen, within } from "@testing-library/react";
import { createFormatter, createTranslator } from "next-intl";
import { describe, expect, it, vi } from "vitest";
import en from "@/messages/en.json";

import { FleetDays } from "./fleet-days";

vi.mock("next-intl/server", () => ({
  getTranslations: async (namespace: string) =>
    createTranslator({ locale: "en", messages: en, namespace } as never),
  getFormatter: async () => createFormatter({ locale: "en" }),
}));

const day = (date: string, users: number, costUsd: number) => ({
  day: date,
  users,
  messages: users * 2,
  turns: users * 3,
  totalTokens: 1_000,
  costUsd,
  cmoCostUsd: costUsd * 2,
});

describe("FleetDays", () => {
  it("leads with today's people and cost, and lists every day in the table", async () => {
    render(
      await FleetDays({
        fleet: {
          days: [day("2026-11-01", 4, 1.25), day("2026-11-02", 2, 0.5)],
        },
      }),
    );

    expect(screen.getByText("Last 2 days, UTC")).toBeTruthy();
    expect(screen.getByText("peak 4 in 2 days")).toBeTruthy();
    expect(screen.getByText("$1.75 in 2 days")).toBeTruthy();
    expect(screen.getByText("Nov 1: 4 people, 8 messages")).toBeTruthy();
    expect(screen.getByText("Nov 2: $0.50")).toBeTruthy();
    expect(screen.getByText("$3.50 in 2 days")).toBeTruthy();
    expect(screen.getByText("Nov 2: $1.00")).toBeTruthy();

    const rows = within(screen.getByRole("table")).getAllByRole("row");
    expect(rows.map((row) => row.textContent)).toEqual([
      "DayPeopleMessagesTurnsTokensSoko BotsCMO.xyz",
      "Nov 22461K$0.50$1.00",
      "Nov 148121K$1.25$2.50",
    ]);
  });
});
