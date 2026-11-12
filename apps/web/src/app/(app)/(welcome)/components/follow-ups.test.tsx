import type { Contact } from "@sokosumi/core-client";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const getContacts = vi.fn();

function translate(key: string, values?: Record<string, unknown>): string {
  return values ? `${key}:${JSON.stringify(values)}` : key;
}

vi.mock("next-intl/server", () => ({
  getTranslations: async () => translate,
  getFormatter: async () => ({
    dateTime: (date: Date) => date.toISOString().slice(0, 10),
  }),
}));
vi.mock("@/lib/clients/core.client", () => ({
  coreClient: { getContacts: (...args: unknown[]) => getContacts(...args) },
}));
vi.mock("@/app/contacts/components/contact-visuals", () => ({
  ContactAvatar: () => <span />,
}));

import {
  FOLLOW_UPS_LIMIT,
  FollowUps,
  type FollowUpsPage,
  loadFollowUps,
} from "./follow-ups";

function contact(id: string, followUpAt: string | null): Contact {
  // Only the fields Follow-ups reads.
  return {
    id,
    name: `Contact ${id}`,
    kind: "PERSON",
    avatarUrl: null,
    nextStep: id === "a" ? "Send the deck" : null,
    followUpAt,
  } as Contact;
}

describe("loadFollowUps", () => {
  afterEach(() => vi.clearAllMocks());

  it("asks Core for contacts due by the reader's day, earliest first", async () => {
    getContacts.mockResolvedValue({
      data: [contact("a", "2026-11-08")],
      meta: { pagination: { total: 9, nextCursor: "a" } },
    });

    await expect(loadFollowUps("2026-11-10")).resolves.toEqual({
      rows: [
        {
          id: "a",
          name: "Contact a",
          kind: "PERSON",
          avatarUrl: null,
          nextStep: "Send the deck",
          followUpAt: "2026-11-08",
        },
      ],
      total: 9,
    });
    expect(getContacts).toHaveBeenCalledWith({
      followUpBy: "2026-11-10",
      sort: "followUpAt",
      direction: "asc",
      limit: FOLLOW_UPS_LIMIT,
    });
  });

  it("gives null instead of failing Home when Core fails", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    getContacts.mockRejectedValue(new Error("down"));

    await expect(loadFollowUps("2026-11-10")).resolves.toBeNull();
  });
});

describe("FollowUps", () => {
  afterEach(() => cleanup());

  async function renderFollowUps(
    feed: FollowUpsPage | null,
  ): Promise<HTMLElement> {
    const { container } = render(
      await FollowUps({ feed: Promise.resolve(feed), today: "2026-11-10" }),
    );
    return container;
  }

  it("links each contact, says overdue or today, and counts the rest", async () => {
    await renderFollowUps({
      rows: [
        {
          id: "a",
          name: "Contact a",
          kind: "PERSON",
          avatarUrl: null,
          nextStep: "Send the deck",
          followUpAt: "2026-11-08",
        },
        {
          id: "b",
          name: "Contact b",
          kind: "PERSON",
          avatarUrl: null,
          nextStep: null,
          followUpAt: "2026-11-10",
        },
      ],
      total: 4,
    });

    expect(screen.getByRole("heading", { name: "title" })).toBeTruthy();
    const links = screen.getAllByRole("link");
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "/contacts?contact=a",
      "/contacts?contact=b",
    ]);
    expect(links[0]?.textContent).toContain("Send the deck");
    expect(links[0]?.textContent).toContain('overdue:{"date":"2026-11-08"}');
    expect(links[1]?.textContent).toContain("today");
    expect(screen.getByText('more:{"count":2}')).toBeTruthy();
  });

  it("renders nothing when nothing is due or the feed failed", async () => {
    expect((await renderFollowUps({ rows: [], total: 0 })).innerHTML).toBe("");
    cleanup();
    expect((await renderFollowUps(null)).innerHTML).toBe("");
  });
});
