import type { ContactDetail } from "@sokosumi/core-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ContactPanel } from "./contact-panel";

// The service is a plain delegate, not the spy itself: Vitest fails a test
// whose spy returned a rejected promise, even when the component catches it.
const { createList, changeMembers, member, toastError } = vi.hoisted(() => ({
  createList: vi.fn(),
  changeMembers: vi.fn(),
  member: { current: (): Promise<unknown> => Promise.resolve() },
  toastError: vi.fn(),
}));

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

vi.mock("@/lib/services/contacts.client", () => ({
  contactsService: {
    get: () => Promise.resolve(LENA),
    interactions: () => Promise.resolve({ items: [], nextCursor: null }),
    activity: () => Promise.resolve({ items: [], nextCursor: null }),
    duplicates: () => Promise.resolve({ groups: [] }),
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

async function createListFromPanel() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ContactPanel
        contactId="c-1"
        lists={[]}
        teammates={[]}
        onClose={vi.fn()}
        onOpenContact={vi.fn()}
        onMerge={vi.fn()}
      />
    </QueryClientProvider>,
  );
  const trigger = await screen.findByRole("button", {
    name: "panel.changeLists",
  });
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
}

describe("ContactPanel lists menu", () => {
  beforeEach(() => {
    createList.mockReset();
    changeMembers.mockReset();
    toastError.mockReset();
    member.current = () => Promise.resolve();
  });

  it("makes a new list from the panel and puts this person on it", async () => {
    await createListFromPanel();
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
});
