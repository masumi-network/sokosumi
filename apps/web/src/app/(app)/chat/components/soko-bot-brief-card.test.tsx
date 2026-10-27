import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
        messageId="msg-1"
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

  it("collapses a long brief behind Show more", async () => {
    const user = userEvent.setup();
    const scroll = vi
      .spyOn(HTMLElement.prototype, "scrollHeight", "get")
      .mockReturnValue(900);
    const client = vi
      .spyOn(HTMLElement.prototype, "clientHeight", "get")
      .mockReturnValue(384);
    try {
      const brief = parseSokoBotBrief(
        "Stand-up ready.\n\n### Results\n- one\n- two",
      );
      if (!brief) throw new Error("expected a brief");
      render(
        <SokoBotBriefCard
          messageId="msg-1"
          brief={brief}
          metadata={meta({ source: "SCHEDULE", schedule_key: "standup" })}
          createdAt="2026-10-26T08:00:00Z"
          renderMarkdown={(content) => <p>{content}</p>}
        />,
      );
      const body = screen.getByTestId("soko-bot-brief-body");
      expect(body.className).toContain("max-h-96");

      await user.click(screen.getByRole("button", { name: "showMore" }));
      expect(body.className).not.toContain("max-h-96");
      expect(
        screen.getByRole("button", { name: "showLess" }),
      ).toBeInTheDocument();
    } finally {
      scroll.mockRestore();
      client.mockRestore();
    }
  });

  it("keeps a short brief open, with title and notes outside the clamp", () => {
    const brief = parseSokoBotBrief(
      "Updated memory.\n\nStand-up ready.\n\n### Focus\n- Catalyst readiness",
    );
    if (!brief) throw new Error("expected a brief");
    render(
      <SokoBotBriefCard
        messageId="msg-1"
        brief={brief}
        metadata={meta({ source: "SCHEDULE", schedule_key: "standup" })}
        createdAt="2026-10-26T08:00:00Z"
        renderMarkdown={(content) => <p>{content}</p>}
      />,
    );
    const body = screen.getByTestId("soko-bot-brief-body");
    expect(body).toHaveTextContent("Stand-up ready.");
    expect(body).not.toHaveTextContent("standup");
    expect(body).not.toHaveTextContent("Updated memory.");
    expect(screen.getByText("Updated memory.")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "showMore" }),
    ).not.toBeInTheDocument();
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
