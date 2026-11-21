import type { ContactDetail, ContactList } from "@sokosumi/core-client";
import { contactDetailHref } from "@sokosumi/utils";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NuqsTestingAdapter } from "nuqs/adapters/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ContactsPage from "@/app/contacts/page";
import { ContactPanel } from "./contact-panel";

// The service is a plain delegate, not the spy itself: Vitest fails a test
// whose spy returned a rejected promise, even when the component catches it.
const { createList, changeMembers, member, toastError, unarchive } = vi.hoisted(
  () => ({
    createList: vi.fn(),
    unarchive: vi.fn(),
    changeMembers: vi.fn(),
    member: { current: (): Promise<unknown> => Promise.resolve() },
    toastError: vi.fn(),
  }),
);

const sessionScope = vi.hoisted(() => ({
  organizationId: null as string | null,
}));
afterEach(() => {
  sessionScope.organizationId = null;
});

const LENA = {
  id: "c-1",
  name: "Lena Fischer",
  kind: "PERSON",
  stage: "LEAD",
  channels: [],
  lists: [],
  mergeSuggestions: [],
  interactionCount: 0,
  score: null,
  organization: "Nordlicht Studio",
  role: null,
  location: null,
  createdAt: "2026-11-12T07:00:00.000Z",
  updatedAt: "2026-11-12T07:00:00.000Z",
} as unknown as ContactDetail;
/** The contact Core returns; a test may swap in an archived one. */
const shown = { current: LENA };

vi.mock("@/lib/services/contacts.client", () => ({
  contactsService: {
    get: (id: string) =>
      sessionScope.organizationId === "org-source"
        ? Promise.reject(new Error("Contact not found"))
        : Promise.resolve(id === shown.current.id ? shown.current : null),
    list: () => Promise.resolve({ contacts: [], nextCursor: null, total: 0 }),
    lists: () => Promise.resolve([]),
    organizations: () => Promise.resolve([]),
    unarchive: (id: string) => {
      unarchive(id);
      return Promise.resolve();
    },
    interactions: () => Promise.resolve({ items: [], nextCursor: null }),
    activity: () => Promise.resolve({ items: [], nextCursor: null }),
    duplicates: () => Promise.resolve([]),
    createList: (body: { name: string }) => {
      createList(body);
      return Promise.resolve({ id: "l-1", kind: "manual", ...body });
    },
    changeMembers: (listId: string, change: unknown) => {
      changeMembers(listId, change);
      return member.current();
    },
  },
}));
vi.mock("@/lib/auth/auth.client", () => ({
  useSession: () => ({
    data: {
      user: { id: "reader" },
      session: { activeOrganizationId: sessionScope.organizationId },
    },
  }),
}));
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { error: toastError, success: vi.fn() }),
}));
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
  useFormatter: () => ({
    dateTime: () => "date",
    relativeTime: () => "now",
    number: String,
  }),
  useNow: () => new Date("2026-11-12T08:00:00.000Z"),
}));

const { selectWorkspace, stayInWorkspace } = vi.hoisted(() => ({
  selectWorkspace: vi.fn(),
  stayInWorkspace: vi.fn(),
}));
vi.mock("next/server", () => ({ connection: async () => {} }));
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  useRouter: () => ({ push: stayInWorkspace }),
}));
vi.mock("next-intl/server", () => ({
  getTranslations: async () => (key: string, values?: { account?: string }) =>
    values?.account ?? key,
}));
vi.mock("@/app/components/user-avatar/workspace-switcher", () => ({
  useWorkspaceSwitcher: () => ({
    handleSelectWorkspace: selectWorkspace,
    isPending: false,
  }),
}));
vi.mock("@/lib/auth/auth.server", () => ({
  getSession: async () => ({
    user: { id: "reader", name: "Reader", email: "reader@example.com" },
    session: { activeOrganizationId: sessionScope.organizationId },
  }),
}));
vi.mock("@/lib/services/user.service", () => ({
  userService: {
    getMyWorkspaces: async () => ({
      workspaces: [
        { id: "personal-workspace", organizationId: null },
        { id: "source-workspace", organizationId: "org-source" },
      ],
    }),
    getMyMembersWithOrganizations: async () => [
      {
        organizationId: "org-source",
        organization: {
          id: "org-source",
          name: "Source team",
          slug: "source",
          logo: null,
        },
      },
    ],
  },
}));
vi.mock("@/lib/services/soko-bot.service", () => ({
  sokoBotService: { getMine: async () => null },
}));

function renderPanel(lists: ContactList[] = []) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ContactPanel
        contactId="c-1"
        lists={lists}
        teammates={[]}
        onClose={vi.fn()}
        onOpenContact={vi.fn()}
        onMerge={vi.fn()}
      />
    </QueryClientProvider>,
  );
  return screen.findByRole("button", { name: "panel.changeLists" });
}

/** Opens New list from the Lists menu with the keyboard only. */
async function openNewListByKeyboard() {
  const trigger = await renderPanel();
  trigger.focus();
  fireEvent.keyDown(trigger, { key: "Enter" });
  const item = await screen.findByRole("menuitem", { name: "panel.newList" });
  item.focus();
  fireEvent.keyDown(item, { key: "Enter" });
  const dialog = await screen.findByRole("dialog", { name: "createTitle" });
  return { trigger, dialog };
}

async function createListFromPanel() {
  const trigger = await renderPanel();
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
  expect(await screen.findByText("panel.noManualLists")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("menuitem", { name: "panel.newList" }));
  const dialog = await screen.findByRole("dialog", {
    name: "createTitle",
  });
  fireEvent.change(within(dialog).getByLabelText("name"), {
    target: { value: "Q1 outreach" },
  });
  fireEvent.click(within(dialog).getByRole("button", { name: "create" }));
  return trigger;
}

async function openContactLink(workspace?: string, client = new QueryClient()) {
  const url = new URL(contactDetailHref(LENA.id), window.location.origin);
  if (workspace) url.searchParams.set("workspace", workspace);
  const page = await ContactsPage({
    searchParams: Promise.resolve(Object.fromEntries(url.searchParams)),
  });
  const view = render(
    <QueryClientProvider client={client}>
      <NuqsTestingAdapter searchParams={url.searchParams}>
        {page}
      </NuqsTestingAdapter>
    </QueryClientProvider>,
  );
  return { url, unmount: view.unmount };
}

it.each([undefined, "personal-workspace"])(
  "opens the linked contact in this workspace and copies its scoped URL (%s)",
  async (workspace) => {
    const user = userEvent.setup();
    const { url } = await openContactLink(workspace);
    const panel = await screen.findByRole("dialog", { name: LENA.name });
    expect(panel).toBeVisible();
    await user.click(within(panel).getByRole("button", { name: "panel.menu" }));
    await user.click(screen.getByRole("menuitem", { name: "panel.copyLink" }));
    url.searchParams.set("workspace", "personal-workspace");
    expect(await navigator.clipboard.readText()).toBe(url.href);
  },
);

it("asks before opening the contact in its accessible source workspace", async () => {
  const user = userEvent.setup();
  await openContactLink("source-workspace");
  const prompt = await screen.findByRole("alertdialog");
  expect(within(prompt).getByText("Source team")).toBeVisible();
  expect(screen.queryByRole("dialog", { name: LENA.name })).toBeNull();
  expect(selectWorkspace).not.toHaveBeenCalled();
  await user.click(within(prompt).getByRole("button", { name: "confirm" }));
  expect(selectWorkspace).toHaveBeenCalledWith("org-source", expect.anything());
  await user.click(within(prompt).getByRole("button", { name: "cancel" }));
  expect(stayInWorkspace).toHaveBeenCalledWith("/contacts");
});

it("does not reuse a contact cached under a different workspace", async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });
  const { unmount } = await openContactLink("personal-workspace", client);
  expect(await screen.findByRole("dialog", { name: LENA.name })).toBeVisible();
  unmount();
  sessionScope.organizationId = "org-source";
  await openContactLink("source-workspace", client);
  expect(screen.queryByRole("dialog", { name: LENA.name })).toBeNull();
  expect(
    await screen.findByRole("dialog", { name: "notFoundTitle" }),
  ).toBeVisible();
});

it("returns a missing page for a workspace outside the reader's memberships", async () => {
  await expect(openContactLink("someone-elses-workspace")).rejects.toThrow(
    "404",
  );
});

describe("ContactPanel lists menu", () => {
  beforeEach(() => {
    createList.mockReset();
    changeMembers.mockReset();
    toastError.mockReset();
    member.current = () => Promise.resolve();
  });

  it("makes a new list from the panel and puts this person on it", async () => {
    const trigger = await createListFromPanel();
    await waitFor(() =>
      expect(changeMembers).toHaveBeenCalledWith("l-1", { add: ["c-1"] }),
    );
    expect(createList).toHaveBeenCalledTimes(1);
    expect(createList).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Q1 outreach" }),
    );
    expect(
      screen.queryByRole("dialog", { name: "createTitle" }),
    ).not.toBeInTheDocument();
    expect(toastError).not.toHaveBeenCalled();
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("moves focus into the dialog and back to Lists on Escape", async () => {
    const { trigger, dialog } = await openNewListByKeyboard();
    await waitFor(() =>
      expect(within(dialog).getByLabelText("name")).toHaveFocus(),
    );
    fireEvent.keyDown(document.activeElement ?? dialog, { key: "Escape" });
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "createTitle" }),
      ).not.toBeInTheDocument(),
    );
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(createList).not.toHaveBeenCalled();
  });

  it("returns focus to Lists when the dialog is cancelled", async () => {
    const { trigger, dialog } = await openNewListByKeyboard();
    fireEvent.click(within(dialog).getByRole("button", { name: "cancel" }));
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("retries only the membership when adding to the new list fails", async () => {
    member.current = () => Promise.reject(new Error("offline"));
    await createListFromPanel();
    await waitFor(() => expect(toastError).toHaveBeenCalledTimes(1));
    const [, options] = toastError.mock.calls[0];
    member.current = () => Promise.resolve();
    options.action.onClick();
    await waitFor(() => expect(changeMembers).toHaveBeenCalledTimes(2));
    expect(changeMembers).toHaveBeenLastCalledWith("l-1", { add: ["c-1"] });
    expect(createList).toHaveBeenCalledTimes(1);
  });

  it("marks the ticked list as saving until Core answers", async () => {
    let answer = () => {};
    member.current = () => new Promise<void>((done) => void (answer = done));
    const investors = {
      id: "l-2",
      name: "Investors",
      kind: "manual",
      color: "blue",
    } as ContactList;
    const trigger = await renderPanel([investors]);
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
    fireEvent.click(
      await screen.findByRole("menuitemcheckbox", { name: "Investors" }),
    );
    const option = screen.getByRole("menuitemcheckbox", { name: "Investors" });
    await waitFor(() => expect(option).toHaveAttribute("aria-busy", "true"));
    expect(
      within(trigger).getByText("Investors").parentElement,
    ).toHaveAttribute("aria-busy", "true");
    answer();
    await waitFor(() => expect(option).not.toHaveAttribute("aria-busy"));
  });
});

describe("ContactPanel archived contact", () => {
  const ARCHIVED = {
    ...LENA,
    archivedAt: "2026-11-10T07:00:00.000Z",
  } as unknown as ContactDetail;

  beforeEach(() => {
    shown.current = LENA;
    unarchive.mockReset();
    changeMembers.mockReset();
  });

  it("is read-only apart from Restore: no Enrich, menu and edits disabled", async () => {
    shown.current = ARCHIVED;
    const lists = await renderPanel();
    expect(screen.getByText("panel.archivedOn")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "panel.enrichHint" }),
    ).toBeNull();
    expect(screen.getByRole("button", { name: "panel.menu" })).toBeDisabled();
    expect(lists).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "panel.changeStage" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "panel.name: Lena Fischer" }),
    ).toBeDisabled();
    expect(screen.getByRole("button", { name: "panel.restore" })).toBeEnabled();
  });

  /** Presses a trigger the way Radix opens a menu: primary-button pointerdown. */
  function press(name: string) {
    fireEvent.pointerDown(screen.getByRole("button", { name }), {
      button: 0,
      ctrlKey: false,
    });
  }
  const EDIT_MENUS = [
    "panel.menu",
    "panel.changeStage",
    "importance.change",
    "panel.changeLists",
  ];

  it("opens no edit menu on an archived contact, so nothing can change", async () => {
    shown.current = ARCHIVED;
    await renderPanel();
    for (const name of EDIT_MENUS) {
      press(name);
      expect(screen.queryByRole("menu")).toBeNull();
    }
    expect(screen.queryByRole("menuitem")).toBeNull();
    expect(changeMembers).not.toHaveBeenCalled();
  });

  it("still opens every edit menu on a live contact", async () => {
    await renderPanel();
    for (const name of EDIT_MENUS) {
      press(name);
      expect(await screen.findByRole("menu")).toBeInTheDocument();
      fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
      await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    }
  });

  it("restores in place: the notice goes and editing comes back", async () => {
    shown.current = ARCHIVED;
    await renderPanel();
    shown.current = LENA;
    fireEvent.click(screen.getByRole("button", { name: "panel.restore" }));
    expect(unarchive).toHaveBeenCalledExactlyOnceWith("c-1");
    await waitFor(() =>
      expect(screen.queryByText("panel.archivedOn")).toBeNull(),
    );
    expect(screen.getByRole("button", { name: "panel.menu" })).toBeEnabled();
    expect(
      screen.getByRole("button", { name: "panel.changeLists" }),
    ).toBeEnabled();
  });

  it("shows no archived notice for a live contact, and offers Archive", async () => {
    await renderPanel();
    expect(screen.queryByText("panel.archivedOn")).toBeNull();
    fireEvent.pointerDown(screen.getByRole("button", { name: "panel.menu" }), {
      button: 0,
      ctrlKey: false,
    });
    expect(
      await screen.findByRole("menuitem", { name: "panel.archive" }),
    ).toBeInTheDocument();
  });
});
