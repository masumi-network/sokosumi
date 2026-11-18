import type { Contact, ContactList } from "@sokosumi/core-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NuqsTestingAdapter } from "nuqs/adapters/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { rows, setStage, undoStage, unarchive, toast } = vi.hoisted(() => ({
  rows: { current: [] as Array<Pick<Contact, "id" | "name">> },
  setStage: vi.fn(),
  undoStage: vi.fn(),
  unarchive: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));
vi.mock("sonner", () => ({ toast }));
vi.mock("@/lib/services/contacts.client", () => ({
  contactsService: { setStage, undoStage, unarchive },
}));
vi.mock("./use-contact-update", () => ({
  useContactUpdate: () => vi.fn(),
  useImportanceUpdate: () => vi.fn(),
}));
vi.mock("./list-overview", () => ({ ListOverview: () => null }));
vi.mock("./companies-view", () => ({ CompaniesView: () => null }));
// The phone list stands in for the Archived rows: a Restore button per row
// when the workspace passes `onRestore`.
vi.mock("./contacts-list", () => ({
  ContactsList: ({
    contacts,
    onRestore,
  }: {
    contacts: Contact[];
    onRestore?: (contact: Contact) => void;
  }) =>
    onRestore ? (
      <ul aria-label="archived rows">
        {contacts.map((contact) => (
          <li key={contact.id}>
            {contact.name}
            <button type="button" onClick={() => onRestore(contact)}>
              restore {contact.name}
            </button>
          </li>
        ))}
      </ul>
    ) : null,
}));
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
  CONTACTS_KEY: ["contacts"],
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
  undoStage.mockReset();
  unarchive.mockReset();
  toast.success.mockReset();
  toast.error.mockReset();
});

function renderSmartList() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <NuqsTestingAdapter searchParams="?list=list-leads">
        <ContactsWorkspace sync={null} />
      </NuqsTestingAdapter>
    </QueryClientProvider>,
  );
}

async function setAllTo(stage: string) {
  await userEvent.click(screen.getByRole("button", { name: "select all" }));
  await userEvent.click(screen.getByRole("button", { name: "bulk.setStage" }));
  await userEvent.click(
    screen.getByRole("menuitemradio", { name: `stages.${stage}` }),
  );
}

/** The Undo action of the last toast of `kind`. */
function undoAction(kind: "success" | "error") {
  const options = toast[kind].mock.lastCall?.[1];
  expect(options?.action?.label).toBe("bulk.undo");
  return options.action.onClick as () => void;
}

describe("ContactsWorkspace bulk relationship", () => {
  it("clears the selection when the change drops rows from a smart list", async () => {
    // The saved list filters by stage; the toolbar stage filter is empty.
    setStage.mockImplementation(async () => {
      rows.current = [];
      return { updated: 2, undo: [] };
    });
    renderSmartList();
    await setAllTo("CUSTOMER");

    expect(setStage).toHaveBeenCalledExactlyOnceWith(["c1", "c2"], "CUSTOMER");
    expect(screen.queryByRole("toolbar", { name: "bulk.label" })).toBeNull();
    expect(screen.queryByText("Ada Lead")).toBeNull();
  });

  it("offers Undo that restores each contact's own earlier stage", async () => {
    const undo = [
      { id: "c1", stage: "LEAD", version: 4 },
      { id: "c2", stage: "PARTNER", version: 2 },
    ];
    setStage.mockResolvedValue({ updated: 2, undo });
    undoStage.mockResolvedValue({ restored: 2, skipped: 0 });
    renderSmartList();
    await setAllTo("CUSTOMER");

    expect(toast.success).toHaveBeenLastCalledWith(
      "bulk.stageSet",
      expect.objectContaining({ closeButton: true }),
    );
    undoAction("success")();
    await waitFor(() =>
      expect(toast.success).toHaveBeenLastCalledWith("bulk.stageUndone"),
    );
    expect(undoStage).toHaveBeenCalledExactlyOnceWith(undo);
  });

  it("offers Undo again when the undo request fails, and reports skips", async () => {
    const undo = [{ id: "c1", stage: "LEAD", version: 4 }];
    setStage.mockResolvedValue({ updated: 1, undo });
    undoStage
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({ restored: 0, skipped: 1 });
    renderSmartList();
    await setAllTo("CUSTOMER");

    undoAction("success")();
    await waitFor(() => expect(toast.error).toHaveBeenCalledOnce());
    undoAction("error")();
    await waitFor(() =>
      expect(toast.success).toHaveBeenLastCalledWith("bulk.stageUndonePartly"),
    );
    expect(undoStage).toHaveBeenCalledTimes(2);
  });

  it("offers no Undo when nothing changed", async () => {
    setStage.mockResolvedValue({ updated: 0, undo: [] });
    renderSmartList();
    await setAllTo("LEAD");
    expect(toast.success).toHaveBeenLastCalledWith("bulk.stageSet", undefined);
  });
});

describe("ContactsWorkspace Archived view", () => {
  function renderAt(searchParams: string) {
    const onUrlUpdate = vi.fn();
    render(
      <QueryClientProvider client={new QueryClient()}>
        <NuqsTestingAdapter
          searchParams={searchParams}
          onUrlUpdate={onUrlUpdate}
          hasMemory
        >
          <ContactsWorkspace sync={null} />
        </NuqsTestingAdapter>
      </QueryClientProvider>,
    );
    return onUrlUpdate;
  }

  it("is no tab: it opens from the More actions menu", async () => {
    renderAt("");
    expect(screen.getByRole("radio", { name: "presets.all" })).toBeChecked();
    expect(
      screen.queryByRole("radio", { name: "presets.archived" }),
    ).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "toolbar.more" }));
    await userEvent.click(
      screen.getByRole("menuitem", { name: "presets.archived" }),
    );
    expect(
      screen.getByRole("heading", { name: "presets.archived" }),
    ).toBeTruthy();
    expect(screen.getByRole("list", { name: "archived rows" })).toBeTruthy();
  });

  it("names the open Archived view and leads back to all contacts", async () => {
    const onUrlUpdate = renderAt("?list=archived");
    expect(
      screen.getByRole("heading", { name: "presets.archived" }),
    ).toBeTruthy();
    expect(screen.queryByRole("radio", { name: "presets.all" })).toBeNull();
    await userEvent.click(
      screen.getByRole("button", { name: "views.backToContacts" }),
    );
    expect(screen.getByRole("radio", { name: "presets.all" })).toBeChecked();
    expect(
      screen.queryByRole("heading", { name: "presets.archived" }),
    ).toBeNull();
    expect(onUrlUpdate.mock.lastCall?.[0].searchParams.get("list")).toBeNull();
  });

  it("keeps the live layouts out of the archive, even from a mixed link", async () => {
    const onUrlUpdate = renderAt("?list=archived&layout=companies");
    expect(
      screen.getByRole("heading", { name: "presets.archived" }),
    ).toBeTruthy();
    expect(screen.getByRole("list", { name: "archived rows" })).toBeTruthy();
    expect(
      screen.queryByRole("radio", { name: "layout.companies" }),
    ).toBeNull();
    await waitFor(() =>
      expect(
        onUrlUpdate.mock.lastCall?.[0].searchParams.get("layout"),
      ).toBeNull(),
    );
    expect(onUrlUpdate.mock.lastCall?.[0].searchParams.get("list")).toBe(
      "archived",
    );
  });

  it("opens the archive from the Companies layout as the archive list", async () => {
    const onUrlUpdate = renderAt("?layout=companies");
    await userEvent.click(screen.getByRole("button", { name: "toolbar.more" }));
    await userEvent.click(
      screen.getByRole("menuitem", { name: "presets.archived" }),
    );
    expect(screen.getByRole("list", { name: "archived rows" })).toBeTruthy();
    expect(
      screen.queryByRole("radio", { name: "layout.companies" }),
    ).toBeNull();
    const url = onUrlUpdate.mock.lastCall?.[0].searchParams;
    expect(url?.get("layout")).toBeNull();
    expect(url?.get("list")).toBe("archived");
  });

  it("moves keyboard focus to the archive heading on entry and to All contacts on the way back", async () => {
    renderAt("");
    screen.getByRole("button", { name: "toolbar.more" }).focus();
    await userEvent.keyboard("{Enter}");
    const item = await screen.findByRole("menuitem", {
      name: "presets.archived",
    });
    item.focus();
    await userEvent.keyboard("{Enter}");
    await waitFor(() =>
      expect(
        screen.getByRole("heading", { name: "presets.archived" }),
      ).toHaveFocus(),
    );

    screen.getByRole("button", { name: "views.backToContacts" }).focus();
    await userEvent.keyboard("{Enter}");
    await waitFor(() =>
      expect(screen.getByRole("radio", { name: "presets.all" })).toHaveFocus(),
    );
  });

  it("lists archived people read-only, without the editable grid or bulk actions", () => {
    renderAt("?list=archived");
    expect(screen.getByRole("list", { name: "archived rows" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "select all" })).toBeNull();
  });

  it("restores a person from their row", async () => {
    unarchive.mockResolvedValue(undefined);
    renderAt("?list=archived");
    await userEvent.click(
      screen.getByRole("button", { name: "restore Ada Lead" }),
    );
    expect(unarchive).toHaveBeenCalledExactlyOnceWith("c1");
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith("panel.restored"),
    );
  });
});
