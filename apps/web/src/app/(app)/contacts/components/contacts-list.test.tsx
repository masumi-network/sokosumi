import type { Contact } from "@sokosumi/core-client";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ContactsList } from "./contacts-list";
import { ContactsBulkBar, ContactsFilterBar } from "./contacts-toolbar";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key}:${Object.values(values).join(",")}` : key,
  useFormatter: () => ({
    relativeTime: () => "3 months ago",
    dateTime: () => "Nov 30",
  }),
}));

const contact = (overrides: Partial<Contact>): Contact => ({
  id: "c-1",
  name: "Marc Dubois",
  organization: "Atelier Nord",
  role: "Founder",
  location: null,
  summary: null,
  whyInteresting: null,
  stage: "LEAD",
  kind: "PERSON",
  score: null,
  nextStep: null,
  followUpAt: null,
  avatarUrl: null,
  customFields: {},
  firstContactAt: new Date("2026-10-01T00:00:00Z"),
  lastContactAt: null,
  interactionCount: 2,
  lastInboundAt: null,
  awaitingReplySince: new Date(Date.now() - 12 * 86_400_000),
  replyState: "NO_REPLY",
  createdByUserId: null,
  createdBySokoBotId: null,
  mergedIntoId: null,
  version: 1,
  archivedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  channels: [
    {
      id: "ch-1",
      type: "EMAIL",
      value: "marc@ateliernord.fr",
      label: null,
      isPrimary: true,
      source: "EMAIL",
      sourceUrl: null,
      verified: false,
      followers: null,
      createdAt: new Date(),
    },
  ],
  lists: [],
  knownBy: [],
  user: null,
  ...overrides,
});

describe("ContactsList", () => {
  it("offers Restore per archived row, apart from opening the person", () => {
    const onOpen = vi.fn();
    const onRestore = vi.fn();
    const archived = contact({ archivedAt: new Date("2026-11-01T00:00:00Z") });
    render(
      <ContactsList
        contacts={[archived]}
        onOpen={onOpen}
        onRestore={onRestore}
        hasMore={false}
        loadingMore={false}
        onLoadMore={() => {}}
        footer="1 of 1"
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "panel.restoreName:Marc Dubois" }),
    );
    expect(onRestore).toHaveBeenCalledExactlyOnceWith(archived);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("offers a follow-up next week per quiet row, and shows one once set", () => {
    const onOpen = vi.fn();
    const onFollowUp = vi.fn();
    const quiet = contact({
      lastContactAt: new Date(Date.now() - 90 * 86_400_000),
    });
    const planned = contact({
      id: "c-2",
      name: "Ana Ruiz",
      followUpAt: "2026-11-30",
    });
    render(
      <ContactsList
        contacts={[quiet, planned]}
        onOpen={onOpen}
        onFollowUp={onFollowUp}
        hasMore={false}
        loadingMore={false}
        onLoadMore={() => {}}
        footer="2 of 2"
      />,
    );
    expect(screen.getAllByText("quiet.lastTalked:3 months ago")).toHaveLength(
      1,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "quiet.followUpName:Marc Dubois" }),
    );
    expect(onFollowUp).toHaveBeenCalledExactlyOnceWith(quiet);
    expect(onOpen).not.toHaveBeenCalled();
    expect(screen.getByText("quiet.followUpOn:Nov 30")).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "quiet.followUpName:Ana Ruiz" }),
    ).toBeNull();
  });

  it("shows the email and how long a reply has been missing, and opens the person", () => {
    const onOpen = vi.fn();
    render(
      <ContactsList
        contacts={[
          contact({}),
          contact({
            id: "c-2",
            name: "Praxis Weber",
            kind: "ORGANIZATION",
            replyState: "IN_CONVERSATION",
            awaitingReplySince: null,
            channels: [],
          }),
        ]}
        onOpen={onOpen}
        hasMore={false}
        loadingMore={false}
        onLoadMore={vi.fn()}
        footer="2 of 2"
      />,
    );
    expect(screen.getByText("marc@ateliernord.fr")).toBeTruthy();
    expect(screen.getByText("replyStates.NO_REPLY")).toBeTruthy();
    expect(screen.getByText("grid.waitingDays:12")).toBeTruthy();
    // Answered conversations stay quiet in the compact list.
    expect(screen.queryByText("replyStates.IN_CONVERSATION")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Praxis Weber/ }));
    expect(onOpen).toHaveBeenCalledWith("c-2");
  });
});

describe("ContactsFilterBar", () => {
  it("shows each filter in force as a chip that clears it", () => {
    const onFilter = vi.fn();
    render(
      <ContactsFilterBar
        filters={{
          stage: null,
          replyState: "NO_REPLY",
          kind: null,
          knownBy: null,
          source: null,
          xFollow: null,
        }}
        onFilter={onFilter}
        teammates={[]}
      />,
    );
    expect(screen.getByText("replyStates.NO_REPLY")).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "toolbar.clearFilter:columns.reply" }),
    );
    expect(onFilter).toHaveBeenCalledWith("replyState", null);
  });
});

describe("ContactsBulkBar", () => {
  it("copies the selected contacts' emails from the bulk bar", () => {
    const onCopyEmails = vi.fn();
    render(
      <ContactsBulkBar
        count={2}
        lists={[]}
        viewList={null}
        onSetStage={vi.fn()}
        onAddToList={vi.fn()}
        onRemoveFromList={vi.fn()}
        onCopyEmails={onCopyEmails}
        onMerge={vi.fn()}
        onClear={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "bulk.copyEmails" }));
    expect(onCopyEmails).toHaveBeenCalledOnce();
  });
});
