import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { TableList } from "./table-list";

const list = vi.hoisted(() => vi.fn());
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: { count?: number }) =>
    values?.count === undefined ? key : `${key}:${values.count}`,
  useFormatter: () => ({ dateTime: () => "date" }),
}));
vi.mock("@/lib/services/data-table.client", () => ({
  dataTableService: { list },
}));

function renderList() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <TableList workspaceId={null} archived={false} />
    </QueryClientProvider>,
  );
}

it("shows the Files list skeleton, then each table's column count", async () => {
  let resolve: (value: unknown) => void = () => {};
  list.mockReturnValue(new Promise((next) => (resolve = next)));
  renderList();
  expect(screen.getByTestId("files-layout-skeleton-list")).toBeInTheDocument();
  expect(screen.queryByText("loading")).toBeNull();
  resolve({
    items: [
      {
        id: "00000000-0000-4000-8000-000000000001",
        title: "Leads",
        columnCount: 3,
        updatedAt: new Date(),
      },
    ],
    nextCursor: null,
  });
  expect(await screen.findByRole("link", { name: /Leads/ })).toHaveAttribute(
    "href",
    "/drive/tables/00000000-0000-4000-8000-000000000001",
  );
  expect(screen.getAllByText("columnCount:3").length).toBeGreaterThan(0);
  expect(list).toHaveBeenCalledTimes(1);
});
