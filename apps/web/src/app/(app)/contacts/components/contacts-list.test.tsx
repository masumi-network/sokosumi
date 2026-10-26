import type { Contact } from "@sokosumi/core-client";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ContactsList } from "./contacts-list";
import { ContactsFilterBar } from "./contacts-toolbar";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key}:${Object.values(values).join(",")}` : key,
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
  firstContactAt: null,
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
      createdAt: new Date(),
    },
  ],
  lists: [],
  knownBy: [],
  ...overrides,
});

describe("ContactsList", () => {
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
        search=""
        onSearch={vi.fn()}
        filters={{
          stage: null,
          replyState: "NO_REPLY",
          kind: null,
          knownBy: null,
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
