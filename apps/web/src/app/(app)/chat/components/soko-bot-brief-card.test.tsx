import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
  useFormatter: () => ({ dateTime: () => "Mon, Oct 26" }),
}));
vi.mock("@/lib/actions/soko-bot/action", () => ({
  sendSokoBotTurnFeedbackAction: vi.fn(),
}));
vi.mock("@/lib/auth/auth.client", () => ({
  useSession: () => ({ data: null }),
}));

import { parseSokoBotBrief } from "@/lib/soko-bot/brief";
import { isSokoBotBriefSource, SokoBotBriefCard } from "./soko-bot-brief-card";

const meta = (soko_bot: Record<string, unknown>) => ({
  soko_bot: { turn_id: "turn-1", ...soko_bot },
});

describe("SokoBotBriefCard", () => {
  it("shows a check-in as title, headline, sections, numbers and notes", () => {
    const brief = parseSokoBotBrief(
      "Updated memory.\n\nCatalyst ships by Nov 1.\n\n### Focus\n- Catalyst readiness\n\nNumbers: 11 Tasks · 9 completed",
    );
    if (!brief) throw new Error("expected a brief");
    render(
      <SokoBotBriefCard
        brief={brief}
        metadata={meta({
          source: "SCHEDULE",
          schedule_name: "Monday plan",
          schedule_key: "monday-plan",
        })}
        createdAt="2026-10-26T08:00:00Z"
        renderMarkdown={(content) => <p>{content}</p>}
      />,
    );
    expect(screen.getByText("Monday plan")).toBeInTheDocument();
    expect(screen.getByText("Mon, Oct 26")).toBeInTheDocument();
    expect(screen.getByText("Catalyst ships by Nov 1.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Focus" })).toBeInTheDocument();
    expect(screen.getByText("11 Tasks")).toBeInTheDocument();
    expect(screen.getByText("9 completed")).toBeInTheDocument();
    expect(screen.getByText("Updated memory.")).toBeInTheDocument();
  });

  it("uses cards only for the bot's own check-ins", () => {
    expect(
      isSokoBotBriefSource(
        meta({ source: "SCHEDULE", schedule_key: "standup" }),
      ),
    ).toBe(true);
    expect(isSokoBotBriefSource(meta({ source: "INGEST" }))).toBe(true);
    expect(isSokoBotBriefSource(meta({ source: "EVENT" }))).toBe(false);
    expect(isSokoBotBriefSource(meta({ source: "CHAT" }))).toBe(false);
    expect(isSokoBotBriefSource(undefined)).toBe(false);
  });
});
