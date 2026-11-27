import type {
  FundraisingPipeline,
  FundraisingProspect,
} from "@sokosumi/core-client";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";
import en from "@/messages/en.json";
import { TestQueryProvider } from "@/test/query-provider";
import { FundraisingBoard } from "./fundraising-board";

const never = vi.hoisted(() => () => new Promise<never>(() => {}));

vi.mock("@/lib/services/fundraising.client", () => ({
  fundraisingService: {
    pipeline: never,
    suggestions: async () => [],
    paths: never,
  },
}));
vi.mock("@/lib/services/contacts.client", () => ({
  contactsService: { members: async () => [] },
}));
vi.mock("@/lib/auth/auth.client", () => ({
  useSession: () => ({
    data: { session: { activeOrganizationId: "org-1" }, user: { id: "me" } },
  }),
}));

const ivy = {
  contact: {
    id: "investor-1",
    name: "Ivy Investor",
    organization: "Fund",
    role: "Partner",
    channels: [],
    lastContactAt: null,
    nextStep: null,
    followUpAt: null,
  },
  stage: "TO_RESEARCH",
  owner: null,
  ticketSize: null,
  thesis: null,
  committedUsd: null,
  notes: null,
  source: null,
  lastDraftAt: null,
  dataRoom: null,
  intro: { via: null, askedAt: null, madeAt: null, declinedAt: null },
  bestPath: null,
} as unknown as FundraisingProspect;

const pipeline = {
  list: { id: "list-1", name: "Investors" },
  rooms: [],
  prospects: [ivy],
  research: { monthUsd: 0, capUsd: 25, perSearchUsd: 0.5, exaConfigured: true },
  mailbox: null,
} as unknown as FundraisingPipeline;

describe("FundraisingBoard", () => {
  it("opens an investor's sheet from the keyboard", async () => {
    const user = userEvent.setup();
    render(
      <TestQueryProvider>
        <NextIntlClientProvider locale="en" messages={en}>
          <FundraisingBoard initialData={pipeline} />
        </NextIntlClientProvider>
      </TestQueryProvider>,
    );

    screen.getByRole("button", { name: /Ivy Investor/ }).focus();
    await user.keyboard("{Enter}");

    expect(
      await screen.findByRole("dialog", { name: "Ivy Investor" }),
    ).toBeTruthy();

    await user.keyboard("{Escape}");
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("button", { name: /Ivy Investor/ }),
      ),
    );
  });
});
