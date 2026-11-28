import type { Contact, ContactList } from "@sokosumi/core-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NuqsTestingAdapter } from "nuqs/adapters/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  rows,
  setStage,
  undoStage,
  unarchive,
  toast,
  update,
  quietCount,
  getContact,
  saveContact,
  written,
} = vi.hoisted(() => ({
  rows: { current: [] as Array<Pick<Contact, "id" | "name" | "channels">> },
  // Like the real hook: saves, then hands the saved contact to `onSaved`.
  update: vi.fn(
    async (
      contact: { id: string; version?: number },
      _fields: unknown,
      _optimistic?: unknown,
      onSaved?: (saved: unknown) => void,
    ) => {
      onSaved?.({ ...contact, version: 8 });
      return true;
    },
  ),
  written: vi.fn(),
  quietCount: { current: 0 },
  getContact: vi.fn(),
  saveContact: vi.fn(),
  setStage: vi.fn(),
  undoStage: vi.fn(),
  unarchive: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: { count?: number }) =>
    key === "selected" || key === "bulk.selected" ? String(values?.count) : key,
  useFormatter: () => ({}),
}));
vi.mock("sonner", () => ({ toast }));
vi.mock("@/lib/services/contacts.client", () => ({
  contactsService: {
    setStage,
    undoStage,
    unarchive,
    get: getContact,
    update: saveContact,
  },
}));
vi.mock("./use-contact-update", () => ({
  useContactUpdate: () => update,
  useImportanceUpdate: () => vi.fn(),
}));
vi.mock("./list-overview", () => ({ ListOverview: () => null }));
// The phone list stands in for the Archived rows: a Restore button per row
// when the workspace passes `onRestore`.
vi.mock("./contacts-list", () => ({
  ContactsList: ({
    contacts,
    onRestore,
    onFollowUp,
  }: {
    contacts: Contact[];
    onRestore?: (contact: Contact) => void;
    onFollowUp?: (contact: Contact) => void;
  }) =>
    onFollowUp ? (
      <ul aria-label="quiet rows">
        {contacts.map((contact) => (
          <li key={contact.id}>
            <button type="button" onClick={() => onFollowUp(contact)}>
              follow up {contact.name}
            </button>
          </li>
        ))}
      </ul>
    ) : onRestore ? (
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
  CONTACT_QUIET_KEY: ["contact-quiet"],
  useQuietCount: () => ({ data: quietCount.current }),
  DUPLICATE_GROUP_LIMIT: 200,
  refreshContacts: vi.fn(async () => {}),
  writeContact: written,
  useContactDuplicates: () => ({ data: [] }),
  useContactLists: () => ({ data: [SMART_LIST] }),
  useCompanyLists: () => ({ data: [] }),
  useCompanies: ({ search = "" }: { search?: string }) => {
    const companies = rows.current
      .filter((row) => row.name.includes(search))
      .map((row) => ({
        ...row,
        listIds: [],
        warmth: "none",
      }));
    return { data: { companies, total: companies.length } };
  },
  useContactMap: () => ({
    data: { places: [], unplaced: 0, pending: 0, withoutLocation: 0 },
    isPending: false,
    error: null,
    refetch: vi.fn(),
  }),
  useContactOrganizations: () => ({ data: [] }),
  useTeammates: () => ({ teammates: [] }),
  useContactRows: ({ search = "" }: { search?: string }) => ({
    data: {
      pages: [
        {
          contacts: rows.current.filter((row) => row.name.includes(search)),
          total: rows.current.length,
        },
      ],
    },
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
    { id: "c1", name: "Ada Lead", channels: [] },
    { id: "c2", name: "Ben Lead", channels: [] },
  ];
  setStage.mockReset();
  undoStage.mockReset();
  unarchive.mockReset();
  toast.success.mockReset();
  toast.error.mockReset();
  update.mockClear();
  written.mockReset();
  getContact.mockReset();
  saveContact.mockReset();
  quietCount.current = 0;
});

function renderSmartList(searchParams = "?list=list-leads") {
  render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: {
            queries: { gcTime: Number.POSITIVE_INFINITY },
            mutations: { gcTime: Number.POSITIVE_INFINITY },
          },
        })
      }
    >
      <NuqsTestingAdapter searchParams={searchParams} hasMemory>
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

describe("search with a bulk selection", () => {
  it.each([
    {
      page: "contacts",
      searchParams: "?list=list-leads",
      selectRole: "button",
      selectName: "select all",
      label: "toolbar.search",
      bulk: "bulk.label",
    },
    {
      page: "companies",
      searchParams: "?layout=companies",
      selectRole: "checkbox",
      selectName: "selectAll",
      label: "search",
      bulk: "bulkLabel",
    },
  ])(
    "preserves the selected $page as search narrows and clears",
    async ({ searchParams, selectRole, selectName, label, bulk }) => {
      renderSmartList(searchParams);
      await userEvent.click(screen.getByRole(selectRole, { name: selectName }));
      const search = screen.getByRole("searchbox", { name: label });
      fireEvent.keyDown(window, { key: "f", ctrlKey: true });
      expect(search).toHaveFocus();
      expect(screen.getByRole("toolbar", { name: bulk })).toHaveTextContent(
        "2",
      );
      await userEvent.type(search, "Ada");
      await waitFor(() =>
        expect(screen.getByRole("toolbar", { name: bulk })).toHaveTextContent(
          "1",
        ),
      );
      await userEvent.clear(search);
      await waitFor(() =>
        expect(screen.getByRole("toolbar", { name: bulk })).toHaveTextContent(
          "2",
        ),
      );
    },
  );
});

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
      <QueryClientProvider
        client={
          new QueryClient({
            defaultOptions: {
              queries: { gcTime: Number.POSITIVE_INFINITY },
              mutations: { gcTime: Number.POSITIVE_INFINITY },
            },
          })
        }
      >
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
    expect(onUrlUpdate).not.toHaveBeenCalled();

    // Leaving a hand-written archived+layout link keeps layout in the URL.
    await userEvent.click(
      screen.getByRole("button", { name: "views.backToContacts" }),
    );
    expect(
      screen.getByRole("heading", { name: "views.companies" }),
    ).toBeTruthy();
    const url = onUrlUpdate.mock.lastCall?.[0].searchParams;
    expect(url?.get("list")).toBeNull();
    expect(url?.get("layout")).toBe("companies");
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

  it("clears the map layout when switching to the archive and returns to table", async () => {
    const onUrlUpdate = renderAt("?layout=map");
    expect(await screen.findByText("emptyTitle")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "toolbar.more" }));
    await userEvent.click(
      screen.getByRole("menuitem", { name: "presets.archived" }),
    );
    expect(screen.getByRole("list", { name: "archived rows" })).toBeTruthy();
    const archiveUrl = onUrlUpdate.mock.lastCall?.[0].searchParams;
    expect(archiveUrl?.get("layout")).toBeNull();
    expect(archiveUrl?.get("list")).toBe("archived");

    await userEvent.click(
      screen.getByRole("button", { name: "views.backToContacts" }),
    );
    expect(screen.getByRole("radio", { name: "presets.all" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "layout.table" })).toBeChecked();
    const backUrl = onUrlUpdate.mock.lastCall?.[0].searchParams;
    expect(backUrl?.get("list")).toBeNull();
    expect(backUrl?.get("layout")).toBeNull();
  });

  it("moves keyboard focus to the archive heading on entry and to All contacts on the way back", async () => {
    renderAt("");
    act(() => screen.getByRole("button", { name: "toolbar.more" }).focus());
    await userEvent.keyboard("{Enter}");
    const item = await screen.findByRole("menuitem", {
      name: "presets.archived",
    });
    act(() => item.focus());
    await userEvent.keyboard("{Enter}");
    await waitFor(() =>
      expect(
        screen.getByRole("heading", { name: "presets.archived" }),
      ).toHaveFocus(),
    );

    act(() =>
      screen.getByRole("button", { name: "views.backToContacts" }).focus(),
    );
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

describe("Gone quiet", () => {
  it("opens from its count, not a tab, and plans a follow-up next week", async () => {
    quietCount.current = 2;
    renderSmartList("");
    expect(screen.queryByRole("radio", { name: "quiet.title" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "quiet.open" }));
    expect(screen.getByRole("heading", { name: "quiet.title" })).toBeTruthy();
    expect(screen.getByText("quiet.hint")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "quiet.open" })).toBeNull();
    await userEvent.click(
      screen.getByRole("button", { name: "follow up Ada Lead" }),
    );
    expect(update).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ id: "c1" }),
      { followUpAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) },
      {},
      expect.any(Function),
    );
    expect(toast.success.mock.lastCall?.[0]).toBe("quiet.followUpSet");
  });

  it("moves focus to the Gone quiet heading on entry", async () => {
    quietCount.current = 2;
    renderSmartList("");
    await userEvent.click(screen.getByRole("button", { name: "quiet.open" }));
    expect(screen.getByRole("heading", { name: "quiet.title" })).toHaveFocus();
  });

  it("undoes on the version its own save returned", async () => {
    quietCount.current = 1;
    saveContact.mockResolvedValue({ id: "c1", name: "Ada Lead", version: 9 });
    renderSmartList("?list=quiet");
    await userEvent.click(
      screen.getByRole("button", { name: "follow up Ada Lead" }),
    );
    await act(async () => undoAction("success")());
    expect(getContact).not.toHaveBeenCalled();
    expect(saveContact).toHaveBeenCalledExactlyOnceWith("c1", {
      followUpAt: null,
      version: 8,
    });
    expect(written).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ version: 9 }),
    );
  });

  it("keeps a teammate's later follow-up: Undo after their edit is refused", async () => {
    quietCount.current = 1;
    // A teammate rescheduled after our save, so Core holds version 9 and
    // refuses our Undo on version 8.
    saveContact.mockRejectedValue({ kind: "contact_version_conflict" });
    renderSmartList("?list=quiet");
    await userEvent.click(
      screen.getByRole("button", { name: "follow up Ada Lead" }),
    );
    written.mockClear();
    await act(async () => undoAction("success")());
    expect(saveContact).toHaveBeenCalledExactlyOnceWith("c1", {
      followUpAt: null,
      version: 8,
    });
    expect(written).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith("errors.versionConflict");
  });

  it("shows no count when nobody went quiet", () => {
    renderSmartList("");
    expect(screen.queryByRole("button", { name: "quiet.open" })).toBeNull();
  });
});
