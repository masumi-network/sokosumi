import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { TableList } from "./table-list";

const list = vi.hoisted(() => vi.fn());
const listContacts = vi.hoisted(() =>
  vi.fn(async () => ({ contacts: [], nextCursor: null, total: 12 })),
);
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: { count?: number }) =>
    values?.count === undefined ? key : `${key}:${values.count}`,
  useFormatter: () => ({ dateTime: () => "date" }),
}));
vi.mock("@/lib/services/data-table.client", () => ({
  dataTableService: { list },
}));

vi.mock("@/lib/services/contacts.client", () => ({
  contactsService: { list: listContacts },
}));

function renderList(archived = false) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <TableList workspaceId={null} archived={archived} />
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

it("pins the workspace's Contacts first, above the tables", async () => {
  list.mockResolvedValue({
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
  renderList();
  const contacts = await screen.findByRole("link", { name: /contactsName/ });
  expect(contacts).toHaveAttribute("href", "/contacts");
  const links = screen.getAllByRole("link");
  expect(links.indexOf(contacts)).toBe(0);
  expect(
    (await screen.findAllByText("contactsCount:12")).length,
  ).toBeGreaterThan(0);
});

it("leaves Contacts out of archived tables", async () => {
  list.mockResolvedValue({ items: [], nextCursor: null });
  renderList(true);
  expect(await screen.findByText("empty")).toBeInTheDocument();
  expect(screen.queryByRole("link", { name: /contactsName/ })).toBeNull();
});
