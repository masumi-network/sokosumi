import type { ChatRoomMessage, CmoOverview } from "@sokosumi/core-client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { toCusoMessages } from "../lib/chat-messages";
import { brandBrainFromForm } from "./brand-brain-editor";
import { Onboarding } from "./onboarding";
import { groupCalendar, StrategyCalendar } from "./strategy-calendar";

const strategy: NonNullable<CmoOverview["strategy"]> = {
  month: "2026-10",
  summary: "Founder led LinkedIn posts that show the product working.",
  goals: ["More demo requests"],
  pillars: ["Product stories"],
  channels: [{ channel: "linkedin", cadence: "3 a week", autonomy: "ask" }],
  calendar: [
    {
      id: "b",
      date: "2026-10-07",
      channel: "linkedin",
      title: "Customer story",
      format: "post",
      status: "draft",
    },
    {
      id: "a",
      date: "2026-10-05",
      channel: "linkedin",
      title: "Why we built it",
      format: "post",
      status: "idea",
    },
  ],
  reviewMode: "suggest",
  weeklyReviews: [],
};

describe("Onboarding", () => {
  it("asks for the website and the goals", () => {
    const html = renderToStaticMarkup(
      <Onboarding name="Ada" onboard={async () => {}} />,
    );
    expect(html).toContain('name="websiteUrl"');
    expect(html).toContain('name="goals"');
    expect(html).toContain("Hi Ada");
  });
});

describe("StrategyCalendar", () => {
  it("groups the calendar by date in order", () => {
    expect(groupCalendar(strategy.calendar).map(([date]) => date)).toEqual([
      "2026-10-05",
      "2026-10-07",
    ]);
  });

  it("shows each channel with its autonomy", () => {
    const html = renderToStaticMarkup(
      <StrategyCalendar strategy={strategy} setAutonomy={async () => {}} />,
    );
    expect(html).toContain("Plan for 2026-10");
    expect(html).toContain("Why we built it");
    expect(html).toContain(
      '<option value="ask" selected="">Ask me first</option>',
    );
  });
});

describe("brandBrainFromForm", () => {
  it("turns one item per line into lists and keeps the rest", () => {
    const previous = {
      summary: "Old",
      voice: { tone: "Calm", do: [], dont: [], examples: [] },
      audience: [],
      products: [],
      competitors: [{ name: "Rival" }],
      channels: [],
    };
    const next = brandBrainFromForm(previous, {
      summary: " New summary ",
      tone: "Direct",
      doLines: "Short sentences\n\nConcrete numbers",
      dontLines: "Hype",
      examples: "",
      audience: "CTOs",
      products: "The platform",
    });
    expect(next.voice.do).toEqual(["Short sentences", "Concrete numbers"]);
    expect(next.summary).toBe("New summary");
    expect(next.competitors).toEqual([{ name: "Rival" }]);
  });
});

describe("toCusoMessages", () => {
  it("keeps top level messages, oldest first, and marks Cuso's", () => {
    const base = {
      parentMessageId: null,
      deletedAt: null,
    } as unknown as ChatRoomMessage;
    const messages = toCusoMessages([
      {
        ...base,
        id: "2",
        content: "Here is the plan.",
        createdAt: new Date("2026-10-01T10:01:00Z"),
        sender: { type: "sokoBot", sokoBot: { name: "Cuso" } },
      } as ChatRoomMessage,
      {
        ...base,
        id: "1",
        content: "Hi",
        createdAt: new Date("2026-10-01T10:00:00Z"),
        sender: { type: "user", user: { name: "Ada" } },
      } as ChatRoomMessage,
      {
        ...base,
        id: "3",
        parentMessageId: "1",
        content: "thread reply",
        createdAt: new Date("2026-10-01T10:02:00Z"),
        sender: { type: "user", user: { name: "Ada" } },
      } as ChatRoomMessage,
    ]);
    expect(messages.map((message) => message.id)).toEqual(["1", "2"]);
    expect(messages[1]?.fromCuso).toBe(true);
  });
});
