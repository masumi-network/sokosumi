import {
  act,
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

  it("retries after the action call itself rejects, keeping rows and cursor", async () => {
    loadMoreMyDay.mockRejectedValueOnce(new Error("Failed to fetch"));
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

    loadMoreMyDay.mockResolvedValueOnce({
      rows: [row(6)],
      total: 6,
      nextCursor: null,
    });
    fireEvent.click(screen.getByRole("button", { name: 'more:{"count":1}' }));

    await waitFor(() =>
      expect(screen.getByRole("link", { name: /Due 6/ })).toBeTruthy(),
    );
    expect(loadMoreMyDay).toHaveBeenNthCalledWith(2, {
      today: "2026-11-10",
      cursor: "t5",
    });
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getAllByTestId("home-my-day-row")).toHaveLength(6);
  });

  describe("a fresh server snapshot", () => {
    // Workspace B's due Tasks, as Home renders them after a switch.
    const workspaceB = {
      rows: [7, 8].map((n) => ({ ...row(n), dueOn: `2026-11-0${n}` })),
      total: 3,
      nextCursor: "t8",
    };

    it("replaces rows and cursor read for the old workspace", async () => {
      loadMoreMyDay.mockResolvedValueOnce({
        rows: [row(6)],
        total: 6,
        nextCursor: null,
      });
      const { rerender } = render(
        <MyDayList
          today="2026-11-10"
          initial={{ rows: firstFive, total: 6, nextCursor: "t5" }}
        />,
      );
      fireEvent.click(screen.getByRole("button", { name: 'more:{"count":1}' }));
      await waitFor(() =>
        expect(screen.getAllByTestId("home-my-day-row")).toHaveLength(6),
      );

      rerender(<MyDayList today="2026-11-10" initial={workspaceB} />);

      expect(
        screen.getAllByTestId("home-my-day-row").map((li) => li.textContent),
      ).toEqual([
        expect.stringContaining("Due 7"),
        expect.stringContaining("Due 8"),
      ]);
      loadMoreMyDay.mockResolvedValueOnce(null);
      fireEvent.click(screen.getByRole("button", { name: 'more:{"count":1}' }));
      await waitFor(() =>
        expect(loadMoreMyDay).toHaveBeenLastCalledWith({
          today: "2026-11-10",
          cursor: "t8",
        }),
      );
    });

    it("starts over for a new day, asking for that day", async () => {
      const { rerender } = render(
        <MyDayList
          today="2026-11-10"
          initial={{ rows: firstFive, total: 6, nextCursor: "t5" }}
        />,
      );
      // Tomorrow's snapshot has its own first page and cursor.
      rerender(
        <MyDayList
          today="2026-11-11"
          initial={{
            rows: [1, 2, 3, 4, 9].map(row),
            total: 7,
            nextCursor: "t9",
          }}
        />,
      );

      loadMoreMyDay.mockResolvedValueOnce(null);
      fireEvent.click(screen.getByRole("button", { name: 'more:{"count":2}' }));
      await waitFor(() =>
        expect(loadMoreMyDay).toHaveBeenCalledWith({
          today: "2026-11-11",
          cursor: "t9",
        }),
      );
      expect(screen.queryByRole("link", { name: /Due 5/ })).toBeNull();
    });

    it("shows refreshed Tasks, not the ones it replaced", () => {
      const { rerender } = render(
        <MyDayList
          today="2026-11-10"
          initial={{ rows: firstFive, total: 6, nextCursor: "t5" }}
        />,
      );
      // Due 1 was completed elsewhere; the refresh no longer lists it.
      rerender(
        <MyDayList
          today="2026-11-10"
          initial={{
            rows: [2, 3, 4, 5, 6].map(row),
            total: 5,
            nextCursor: null,
          }}
        />,
      );

      expect(screen.queryByRole("link", { name: /Due 1/ })).toBeNull();
      expect(screen.getByRole("link", { name: /Due 6/ })).toBeTruthy();
      expect(screen.queryByRole("button")).toBeNull();
    });

    it("drops a page still loading for the snapshot it replaced", async () => {
      let resolveOld: (page: unknown) => void = () => {};
      loadMoreMyDay.mockReturnValueOnce(
        new Promise((resolve) => {
          resolveOld = resolve;
        }),
      );
      const { rerender } = render(
        <MyDayList
          today="2026-11-10"
          initial={{ rows: firstFive, total: 6, nextCursor: "t5" }}
        />,
      );
      fireEvent.click(screen.getByRole("button", { name: 'more:{"count":1}' }));

      rerender(<MyDayList today="2026-11-10" initial={workspaceB} />);
      await act(async () => {
        resolveOld({ rows: [row(6)], total: 6, nextCursor: null });
      });

      expect(
        screen.getAllByTestId("home-my-day-row").map((li) => li.textContent),
      ).toEqual([
        expect.stringContaining("Due 7"),
        expect.stringContaining("Due 8"),
      ]);
      expect(screen.queryByRole("link", { name: /Due 6/ })).toBeNull();
    });
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
