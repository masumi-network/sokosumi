import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/app/history/actions", () => ({ loadMoreHistory: vi.fn() }));
vi.mock("./history-list-item", () => ({
  HistoryListItem: ({ item }: { item: { title: string } }) => (
    <span>{item.title}</span>
  ),
}));
vi.mock("@/lib/utils/datetime.client", () => ({
  useLocalizedDateTime: () => ({
    formatMonthYear: (date: string | Date) =>
      new Intl.DateTimeFormat("en", {
        month: "long",
        year: "numeric",
        timeZone: "UTC",
      }).format(new Date(date)),
  }),
}));

import type { TransactionHistoryItem } from "@/lib/services/history.service";

import { HistoryList } from "./history-list";

function item(id: string, consumedAt: string): TransactionHistoryItem {
  return {
    id,
    kind: "unattributed",
    title: id,
    description: null,
    credits: 1,
    consumedAt: new Date(consumedAt),
    projectId: null,
    owner: null,
    bucketSource: null,
  };
}

const labels = {
  empty: { title: "Empty", description: "" },
  loadMore: "More",
  loadMoreError: "Error",
  row: {} as never,
};

describe("HistoryList month headings", () => {
  it("opens each run of one month with its heading", () => {
    render(
      <HistoryList
        history={[
          item("a", "2026-09-20T10:00:00Z"),
          item("b", "2026-09-02T10:00:00Z"),
          item("c", "2026-08-30T10:00:00Z"),
        ]}
        nextCursor={null}
        filterResetKey="k"
        filters={{ q: null, scope: "owned", type: null, projectId: null }}
        labels={labels}
        activeOrganizationId={null}
      />,
    );

    const headings = screen.getAllByRole("heading", { level: 2 });
    expect(headings.map((heading) => heading.textContent)).toEqual([
      "September 2026",
      "August 2026",
    ]);
    const list = screen.getByRole("list");
    expect(within(list).getAllByText(/^[abc]$/)).toHaveLength(3);
  });
});
