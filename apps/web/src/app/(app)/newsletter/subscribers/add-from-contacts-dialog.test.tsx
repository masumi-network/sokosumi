import type {
  Contact,
  ContactList,
  NewsletterAddFromContactsResult,
} from "@sokosumi/core-client";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import en from "@/messages/en.json";
import { TestQueryProvider } from "@/test/query-provider";

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  lists: vi.fn(),
  add: vi.fn(),
  refresh: vi.fn(),
  close: vi.fn(),
  focus: vi.fn(),
}));
vi.mock("@/lib/services/contacts.client", () => ({
  contactsService: { list: mocks.list, lists: mocks.lists },
}));
vi.mock("@/lib/actions/newsletter/subscribers", () => ({
  addNewsletterSubscribersFromContacts: mocks.add,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mocks.refresh }),
}));

import { AddFromContactsDialog } from "./add-from-contacts-dialog";

const COPY = en.App.Projects.Newsletter.Subscribers;
const ADA: Contact = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Ada Lovelace",
  organization: "Analytical Engines",
  role: null,
  location: null,
  summary: null,
  whyInteresting: null,
  stage: "CONTACT",
  kind: "PERSON",
  score: null,
  nextStep: null,
  followUpAt: null,
  avatarUrl: null,
  customFields: {},
  firstContactAt: null,
  lastContactAt: null,
  interactionCount: 0,
  lastInboundAt: null,
  awaitingReplySince: null,
  replyState: null,
  createdByUserId: null,
  createdBySokoBotId: null,
  mergedIntoId: null,
  version: 1,
  archivedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  lists: [],
  knownBy: [],
  channels: [
    {
      id: "email-1",
      type: "EMAIL",
      value: "ada@example.com",
      label: null,
      isPrimary: true,
      source: "MANUAL",
      sourceUrl: null,
      verified: false,
      createdAt: new Date(),
    },
  ],
};
const NO_EMAIL: Contact = {
  ...ADA,
  id: "22222222-2222-4222-8222-222222222222",
  name: "Grace Hopper",
  organization: "Navy",
  channels: [],
};
const LIST: ContactList = {
  id: "33333333-3333-4333-8333-333333333333",
  name: "Friends",
  color: "blue",
  description: null,
  kind: "manual",
  smartFilter: null,
  count: 12,
  createdByUserId: null,
  createdBySokoBotId: null,
  createdAutomatically: false,
  createdAt: new Date(),
  updatedAt: new Date(),
};
const SUMMARY: NewsletterAddFromContactsResult = {
  added: 2,
  alreadySubscribed: 3,
  skippedUnsubscribed: 4,
  skippedBounced: 5,
  skippedNoEmail: 6,
  pendingConfirmation: 7,
};

function renderDialog() {
  render(
    <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
      <TestQueryProvider>
        <AddFromContactsDialog
          projectId="p1"
          newsletterName="Weekly"
          onClose={mocks.close}
          onCloseAutoFocus={mocks.focus}
        />
      </TestQueryProvider>
    </NextIntlClientProvider>,
  );
  return userEvent.setup();
}

async function selectAda(user: ReturnType<typeof userEvent.setup>) {
  await user.click(
    await screen.findByRole("checkbox", { name: /Ada Lovelace/ }),
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.list.mockResolvedValue({
    contacts: [ADA, NO_EMAIL],
    nextCursor: null,
    total: 2,
  });
  mocks.lists.mockResolvedValue([LIST]);
  mocks.add.mockResolvedValue({ ok: true, value: SUMMARY });
});

describe("AddFromContactsDialog", () => {
  it("lists workspace contacts with organization and email, and disables people without an email", async () => {
    const user = renderDialog();
    expect(await screen.findByText(ADA.name)).toBeInTheDocument();
    expect(screen.getByText("Analytical Engines")).toBeInTheDocument();
    expect(screen.getByText("ada@example.com")).toBeInTheDocument();
    expect(screen.getByText(COPY.FromContacts.noEmail)).toBeInTheDocument();
    const disabled = screen.getByRole("checkbox", { name: /Grace Hopper/ });
    expect(disabled).toBeDisabled();
    await user.click(disabled);
    expect(disabled).not.toBeChecked();
    expect(mocks.list).toHaveBeenCalledWith({
      search: undefined,
      sort: "name",
      direction: "asc",
      cursor: undefined,
      limit: 50,
    });
    expect(
      screen.getByRole("button", { name: COPY.FromContacts.add }),
    ).toBeDisabled();
  });

  it("requires consent, submits people and lists with ASK, and shows every Core result count", async () => {
    const user = renderDialog();
    expect(
      screen.queryByRole("radio", { checked: true }),
    ).not.toBeInTheDocument();
    await selectAda(user);
    await user.click(
      screen.getByRole("tab", { name: COPY.FromContacts.lists }),
    );
    expect(await screen.findByText("12 members")).toBeInTheDocument();
    await user.click(screen.getByRole("checkbox", { name: /Friends/ }));
    expect(
      screen.getByText("1 person selected · 1 list selected"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: COPY.FromContacts.add }),
    ).toBeDisabled();
    expect(mocks.add).not.toHaveBeenCalled();
    await user.click(screen.getByRole("radio", { name: COPY.Consent.ASK }));
    await user.click(
      screen.getByRole("button", { name: COPY.FromContacts.add }),
    );
    await waitFor(() =>
      expect(mocks.add).toHaveBeenCalledWith({
        projectId: "p1",
        values: {
          contactIds: [ADA.id],
          listIds: [LIST.id],
          consent: "ASK",
          consentConfirmed: false,
        },
      }),
    );
    for (const key of Object.keys(
      SUMMARY,
    ) as (keyof NewsletterAddFromContactsResult)[]) {
      const label = await screen.findByText(COPY.FromContacts.result[key]);
      expect(label.parentElement).toHaveTextContent(String(SUMMARY[key]));
    }
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: COPY.done }));
    expect(mocks.close).toHaveBeenCalled();
  });

  it("requires the confirmation checkbox for CONFIRMED and clears it when switching modes", async () => {
    const user = renderDialog();
    await selectAda(user);
    await user.click(
      screen.getByRole("radio", { name: COPY.Consent.CONFIRMED }),
    );
    expect(
      screen.getByRole("button", { name: COPY.FromContacts.add }),
    ).toBeDisabled();
    await user.click(
      screen.getByRole("checkbox", { name: COPY.Consent.confirm }),
    );
    expect(
      screen.getByRole("button", { name: COPY.FromContacts.add }),
    ).toBeEnabled();
    await user.click(screen.getByRole("radio", { name: COPY.Consent.ASK }));
    await user.click(
      screen.getByRole("radio", { name: COPY.Consent.CONFIRMED }),
    );
    expect(
      screen.getByRole("checkbox", { name: COPY.Consent.confirm }),
    ).not.toBeChecked();
    expect(
      screen.getByRole("button", { name: COPY.FromContacts.add }),
    ).toBeDisabled();
    await user.click(
      screen.getByRole("checkbox", { name: COPY.Consent.confirm }),
    );
    await user.click(
      screen.getByRole("button", { name: COPY.FromContacts.add }),
    );
    await waitFor(() =>
      expect(mocks.add).toHaveBeenCalledWith({
        projectId: "p1",
        values: {
          contactIds: [ADA.id],
          listIds: [],
          consent: "CONFIRMED",
          consentConfirmed: true,
        },
      }),
    );
  });

  it("searches all workspace contacts and keeps selections after the search changes", async () => {
    const user = renderDialog();
    await selectAda(user);
    await user.type(
      screen.getByRole("searchbox", { name: COPY.FromContacts.search }),
      "Grace",
    );
    await waitFor(() =>
      expect(mocks.list).toHaveBeenCalledWith(
        expect.objectContaining({ search: "Grace" }),
      ),
    );
    expect(screen.queryByText(ADA.name)).not.toBeInTheDocument();
    expect(
      screen.getByText("1 person selected · 0 lists selected"),
    ).toBeInTheDocument();
    await user.clear(screen.getByRole("searchbox"));
    expect(
      await screen.findByRole("checkbox", { name: /Ada Lovelace/ }),
    ).toBeChecked();
  });

  it("loads the next page of people", async () => {
    mocks.list.mockImplementation(async (query: { cursor?: string }) =>
      query.cursor
        ? {
            contacts: [{ ...ADA, id: "c3", name: "Katherine Johnson" }],
            nextCursor: null,
            total: 3,
          }
        : { contacts: [ADA, NO_EMAIL], nextCursor: "page2", total: 3 },
    );
    const user = renderDialog();
    await user.click(
      await screen.findByRole("button", { name: COPY.FromContacts.loadMore }),
    );
    expect(await screen.findByText("Katherine Johnson")).toBeInTheDocument();
    expect(screen.getByText(ADA.name)).toBeInTheDocument();
    expect(mocks.list).toHaveBeenCalledWith(
      expect.objectContaining({ cursor: "page2" }),
    );
  });

  it("allows selecting a whole list without selecting individual people", async () => {
    const user = renderDialog();
    await user.click(
      screen.getByRole("tab", { name: COPY.FromContacts.lists }),
    );
    await user.click(await screen.findByRole("checkbox", { name: /Friends/ }));
    await user.click(screen.getByRole("radio", { name: COPY.Consent.ASK }));
    await user.click(
      screen.getByRole("button", { name: COPY.FromContacts.add }),
    );
    await waitFor(() =>
      expect(mocks.add).toHaveBeenCalledWith({
        projectId: "p1",
        values: {
          contactIds: [],
          listIds: [LIST.id],
          consent: "ASK",
          consentConfirmed: false,
        },
      }),
    );
  });

  it("shows empty people and list states", async () => {
    mocks.list.mockResolvedValue({ contacts: [], nextCursor: null, total: 0 });
    mocks.lists.mockResolvedValue([]);
    const user = renderDialog();
    expect(
      await screen.findByText(COPY.FromContacts.noPeople),
    ).toBeInTheDocument();
    await user.click(
      screen.getByRole("tab", { name: COPY.FromContacts.lists }),
    );
    expect(screen.getByText(COPY.FromContacts.noLists)).toBeInTheDocument();
  });

  it.each(["people", "lists"] as const)(
    "offers retry when %s cannot load",
    async (kind) => {
      const mock = kind === "people" ? mocks.list : mocks.lists;
      mock.mockRejectedValueOnce(new Error("Offline"));
      const user = renderDialog();
      if (kind === "lists")
        await user.click(
          screen.getByRole("tab", { name: COPY.FromContacts.lists }),
        );
      expect(await screen.findByRole("alert")).toHaveTextContent(
        kind === "people"
          ? COPY.FromContacts.loadPeopleError
          : COPY.FromContacts.loadListsError,
      );
      await user.click(
        screen.getByRole("button", { name: COPY.FromContacts.retry }),
      );
      expect(
        await screen.findByText(kind === "people" ? ADA.name : LIST.name),
      ).toBeInTheDocument();
    },
  );

  it.each(["returned", "thrown"])(
    "retains selections on a %s mutation error",
    async (failure) => {
      if (failure === "returned")
        mocks.add.mockResolvedValue({
          ok: false,
          error: { message: COPY.FromContacts.error },
        });
      else mocks.add.mockRejectedValue(new Error("Offline"));
      const user = renderDialog();
      await selectAda(user);
      await user.click(screen.getByRole("radio", { name: COPY.Consent.ASK }));
      await user.click(
        screen.getByRole("button", { name: COPY.FromContacts.add }),
      );
      expect(await screen.findByRole("alert")).toHaveTextContent(
        COPY.FromContacts.error,
      );
      expect(
        screen.getByRole("checkbox", { name: /Ada Lovelace/ }),
      ).toBeChecked();
      expect(mocks.refresh).not.toHaveBeenCalled();
    },
  );

  it("blocks duplicate submissions and dismissal while adding", async () => {
    const deferred = Promise.withResolvers<{
      ok: true;
      value: NewsletterAddFromContactsResult;
    }>();
    mocks.add.mockReturnValue(deferred.promise);
    const user = renderDialog();
    await selectAda(user);
    await user.click(screen.getByRole("radio", { name: COPY.Consent.ASK }));
    await user.click(
      screen.getByRole("button", { name: COPY.FromContacts.add }),
    );
    expect(
      screen.getByRole("button", { name: COPY.FromContacts.add }),
    ).toHaveAttribute("aria-busy", "true");
    expect(
      screen.getByRole("checkbox", { name: /Ada Lovelace/ }),
    ).toBeDisabled();
    expect(screen.getByRole("button", { name: COPY.cancel })).toBeDisabled();
    await user.click(
      screen.getByRole("button", { name: COPY.FromContacts.add }),
    );
    await user.keyboard("{Escape}");
    expect(mocks.close).not.toHaveBeenCalled();
    expect(mocks.add).toHaveBeenCalledTimes(1);
    await act(async () => deferred.resolve({ ok: true, value: SUMMARY }));
    expect(
      await screen.findByRole("button", { name: COPY.done }),
    ).toBeInTheDocument();
  });
});
