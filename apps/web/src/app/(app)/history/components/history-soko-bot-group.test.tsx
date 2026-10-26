import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { HistoryListItemLabels } from "@/app/history/components/history-list-item";
import type { TransactionHistoryItem } from "@/lib/services/history.service";

vi.mock("next-intl", () => ({
  useTimeZone: () => "UTC",
  useLocale: () => "en",
  useTranslations:
    () => (key: string, values?: { count?: number; name?: string }) =>
      key === "sokoBotTurns"
        ? `${values?.count} interactions`
        : `${values?.name}'s interactions`,
  useFormatter: () => ({
    number: (value: number, options?: Intl.NumberFormatOptions) =>
      value.toLocaleString("en-US", options),
  }),
}));

import { HistorySokoBotGroup } from "./history-soko-bot-group";

const labels: HistoryListItemLabels = {
  credit: "credit",
  credits: "credits",
  noDescription: "No description",
  consumed: "Consumed",
  kind: {
    job: "Agent job",
    image: "Image",
    task: "Task",
    coworker: "Coworker",
    sokoBot: "Soko Bot",
    topUp: "Top up",
    unattributed: "Other",
  },
};

function turn(id: string, description: string) {
  return {
    id,
    kind: "sokoBot",
    sokoBotId: "joseph",
    title: "Soko Bot · Joseph",
    description,
    credits: 0.75,
    consumedAt: new Date("2026-10-23T10:00:00Z"),
    projectId: null,
    owner: null,
  } as Extract<TransactionHistoryItem, { kind: "sokoBot" }>;
}

describe("HistorySokoBotGroup", () => {
  it("summarises a day of turns and opens to show each one", () => {
    render(
      <HistorySokoBotGroup
        items={[turn("a", "Morning briefing"), turn("b", "Inbox check")]}
        credits={1.5}
        labels={labels}
        activeOrganizationId={null}
      />,
    );
    const summary = screen.getByRole("button", { name: /2 interactions/ });
    expect(summary).toHaveTextContent("Soko Bot · Joseph");
    expect(summary).toHaveTextContent("1.5 credits");
    expect(summary).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Inbox check")).not.toBeInTheDocument();

    fireEvent.click(summary);

    expect(summary).toHaveAttribute("aria-expanded", "true");
    const turns = screen.getByRole("list", {
      name: "Soko Bot · Joseph's interactions",
    });
    expect(within(turns).getByText("Morning briefing")).toBeInTheDocument();
    expect(within(turns).getByText("Inbox check")).toBeInTheDocument();
  });
});
