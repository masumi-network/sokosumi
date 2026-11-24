import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next-intl/server", () => ({
  getTranslations: async (namespace: string) => (key: string) =>
    `${namespace.split(".").at(-1)}.${key}`,
  getFormatter: async () => ({ dateTime: () => "10:30" }),
}));

import { GoingOutToday } from "./going-out-today";
import type { GoingOutPage } from "./going-out-today-data";

const at = new Date("2026-11-24T09:30:00Z");
const calendarHref = "/calendar?date=2026-11-24&view=week";

describe("GoingOutToday", () => {
  afterEach(() => cleanup());

  async function renderGoingOut(feed: GoingOutPage | null) {
    const { container } = render(
      await GoingOutToday({ feed: Promise.resolve(feed) }),
    );
    return container;
  }

  const page: GoingOutPage = {
    rows: [
      {
        id: "c1",
        kind: "social",
        at,
        title: "Launch day",
        status: "NEEDS_APPROVAL",
        href: "/social?projectId=proj&postId=p1",
      },
      {
        id: "c2",
        kind: "task",
        at,
        title: "Daily digest",
        status: "PLANNED",
        href: "/schedules/s1",
      },
    ],
    total: 2,
    calendarHref,
  };

  it("lists each row with its time, kind and own status, linking to it", async () => {
    await renderGoingOut(page);

    expect(
      screen.getByRole("heading", { name: "GoingOut.title" }),
    ).toBeTruthy();
    const post = screen.getByRole("link", { name: /Launch day/ });
    expect(post.getAttribute("href")).toBe("/social?projectId=proj&postId=p1");
    expect(post.textContent).toContain("10:30");
    expect(post.textContent).toContain("GoingOut.kinds.social");
    // Waiting for approval is said, not shown as going out for sure.
    expect(post.textContent).toContain("status.NEEDS_APPROVAL");
    expect(
      screen.getByRole("link", { name: /Daily digest/ }).textContent,
    ).toContain("GoingOut.planned");
  });

  it("links to the rest of the day on the Calendar", async () => {
    await renderGoingOut(page);

    expect(
      screen
        .getByRole("link", { name: "GoingOut.seeAll" })
        .getAttribute("href"),
    ).toBe(calendarHref);
  });

  it("renders nothing on a quiet day or when the read failed", async () => {
    expect(
      (await renderGoingOut({ rows: [], total: 0, calendarHref })).innerHTML,
    ).toBe("");
    expect((await renderGoingOut(null)).innerHTML).toBe("");
  });
});
