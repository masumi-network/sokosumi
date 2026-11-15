import type { Contact, ContactList } from "@sokosumi/core-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NuqsTestingAdapter } from "nuqs/adapters/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { rows, setStage } = vi.hoisted(() => ({
  rows: { current: [] as Array<Pick<Contact, "id" | "name">> },
  setStage: vi.fn(),
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/services/contacts.client", () => ({
  contactsService: { setStage },
}));
vi.mock("./use-contact-update", () => ({
  useContactUpdate: () => vi.fn(),
  useImportanceUpdate: () => vi.fn(),
}));
vi.mock("./list-overview", () => ({ ListOverview: () => null }));
vi.mock("./contacts-list", () => ({ ContactsList: () => null }));
// The grid stands in for row checkboxes: one button selects every row shown.
vi.mock("./contacts-grid", () => ({
  ContactsGrid: ({
    contacts,
    onSelectedChange,
  }: {
    contacts: Array<Pick<Contact, "id" | "name">>;
    onSelectedChange: (ids: string[]) => void;
  }) => (
    <div>
      {contacts.map((contact) => (
        <p key={contact.id}>{contact.name}</p>
      ))}
      <button
        type="button"
        onClick={() => onSelectedChange(contacts.map((contact) => contact.id))}
      >
        select all
      </button>
    </div>
  ),
}));

const SMART_LIST: ContactList = {
  id: "list-leads",
  name: "Leads",
  color: "violet",
  description: null,
  kind: "smart",
  smartFilter: { stages: ["LEAD"] },
  count: 2,
  createdByUserId: null,
  createdBySokoBotId: null,
  createdAutomatically: false,
  createdAt: new Date(),
  updatedAt: new Date(),
};

vi.mock("./use-contacts-data", () => ({
  CONTACT_LISTS_KEY: ["contact-lists"],
  DUPLICATE_GROUP_LIMIT: 200,
  refreshContacts: vi.fn(async () => {}),
  useContactDuplicates: () => ({ data: [] }),
  useContactLists: () => ({ data: [SMART_LIST] }),
  useContactMap: () => undefined,
  useContactOrganizations: () => ({ data: [] }),
  useTeammates: () => ({ teammates: [] }),
  useContactRows: () => ({
    data: { pages: [{ contacts: rows.current, total: rows.current.length }] },
    isPending: false,
    isPlaceholderData: false,
    error: null,
    hasNextPage: false,
    isFetchingNextPage: false,
    fetchNextPage: vi.fn(),
    refetch: vi.fn(),
  }),
}));

const { ContactsWorkspace } = await import("./contacts-workspace");

beforeEach(() => {
  rows.current = [
    { id: "c1", name: "Ada Lead" },
    { id: "c2", name: "Ben Lead" },
  ];
  setStage.mockReset();
});

describe("ContactsWorkspace bulk relationship", () => {
  it("clears the selection when the change drops rows from a smart list", async () => {
    // The saved list filters by stage; the toolbar stage filter is empty.
    setStage.mockImplementation(async () => {
      rows.current = [];
      return { updated: 2 };
    });
    render(
      <QueryClientProvider client={new QueryClient()}>
        <NuqsTestingAdapter searchParams="?list=list-leads">
          <ContactsWorkspace sync={null} />
        </NuqsTestingAdapter>
      </QueryClientProvider>,
    );

    await userEvent.click(screen.getByRole("button", { name: "select all" }));
    await userEvent.click(
      screen.getByRole("button", { name: "bulk.setStage" }),
    );
    await userEvent.click(
      screen.getByRole("menuitemradio", { name: "stages.CUSTOMER" }),
    );

    expect(setStage).toHaveBeenCalledExactlyOnceWith(["c1", "c2"], "CUSTOMER");
    expect(screen.queryByRole("toolbar", { name: "bulk.label" })).toBeNull();
    expect(screen.queryByText("Ada Lead")).toBeNull();
  });
});
