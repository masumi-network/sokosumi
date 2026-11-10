import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const loadMoreMyDay = vi.fn();

function translate(key: string, values?: Record<string, unknown>): string {
  return values ? `${key}:${JSON.stringify(values)}` : key;
}

vi.mock("next-intl", () => ({ useTranslations: () => translate }));
vi.mock("../actions", () => ({
  loadMoreMyDay: (...args: unknown[]) => loadMoreMyDay(...args),
}));
vi.mock("@/app/tasks/components/task-due-badge", () => ({
  TaskDueBadge: ({ dueOn }: { dueOn: string }) => <span>due {dueOn}</span>,
}));

import type { MyDayRow } from "./my-day";
import { MyDayList } from "./my-day-list.client";

function row(n: number): MyDayRow {
  return {
    id: `t${n}`,
    name: `Due ${n}`,
    status: "READY",
    dueOn: `2026-11-0${n}`,
    href: `/tasks/t${n}`,
  };
}

// Six Tasks match (owned or assigned, open, due by today). Core leaves the
// unrelated ones out, so the list only ever pages through these six.
const firstFive = [1, 2, 3, 4, 5].map(row);

describe("MyDayList", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("reaches the sixth due Task in place, from the same query", async () => {
    loadMoreMyDay.mockResolvedValue({
      rows: [row(6)],
      total: 6,
      nextCursor: null,
    });
    render(
      <MyDayList
        today="2026-11-10"
        initial={{ rows: firstFive, total: 6, nextCursor: "t5" }}
      />,
    );

    expect(screen.getAllByTestId("home-my-day-row")).toHaveLength(5);
    expect(screen.queryByRole("link", { name: /Due 6/ })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: 'more:{"count":1}' }));

    await waitFor(() =>
      expect(
        screen.getByRole("link", { name: /Due 6/ }).getAttribute("href"),
      ).toBe("/tasks/t6"),
    );
    expect(loadMoreMyDay).toHaveBeenCalledWith({
      today: "2026-11-10",
      cursor: "t5",
    });
    expect(screen.getAllByTestId("home-my-day-row")).toHaveLength(6);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("keeps its rows and says so when the next page fails", async () => {
    loadMoreMyDay.mockResolvedValue(null);
    render(
      <MyDayList
        today="2026-11-10"
        initial={{ rows: firstFive, total: 6, nextCursor: "t5" }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: 'more:{"count":1}' }));

    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toBe("error"),
    );
    expect(screen.getAllByTestId("home-my-day-row")).toHaveLength(5);
    expect(
      screen.getByRole("button", { name: 'more:{"count":1}' }),
    ).toBeTruthy();
  });

  it("shows no button when every due Task fits", () => {
    render(
      <MyDayList
        today="2026-11-10"
        initial={{ rows: [row(1)], total: 1, nextCursor: null }}
      />,
    );

    expect(screen.queryByRole("button")).toBeNull();
  });
});
