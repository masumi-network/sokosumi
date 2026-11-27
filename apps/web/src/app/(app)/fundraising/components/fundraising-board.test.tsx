import type {
  ContactSuggestion,
  FundraisingPipeline,
  FundraisingProspect,
} from "@sokosumi/core-client";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";
import {
  testContact,
  testPipeline,
  testProspect,
  testSuggestion,
} from "@/app/fundraising/fundraising-fixtures";
import en from "@/messages/en.json";
import { TestQueryProvider } from "@/test/query-provider";
import { FundraisingBoard } from "./fundraising-board";

const service = vi.hoisted(() => {
  const never = () => new Promise<never>(() => {});
  return {
    pipeline: never,
    suggestions: vi.fn(async () => [] as ContactSuggestion[]),
    paths: never,
    updateProspect: vi.fn(),
    dismissSuggestions: vi.fn(async () => undefined),
    find: vi.fn(),
  };
});

vi.mock("@/lib/services/fundraising.client", () => ({
  fundraisingService: service,
}));
vi.mock("@/lib/services/contacts.client", () => ({
  contactsService: { members: async () => [] },
}));
vi.mock("@/lib/auth/auth.client", () => ({
  useSession: () => ({
    data: { session: { activeOrganizationId: "org-1" }, user: { id: "me" } },
  }),
}));

function renderBoard(
  prospect: FundraisingProspect = testProspect(),
  pipeline: Partial<FundraisingPipeline> = {},
) {
  render(
    <TestQueryProvider>
      <NextIntlClientProvider locale="en" messages={en}>
        <FundraisingBoard
          initialData={testPipeline({ prospects: [prospect], ...pipeline })}
        />
      </NextIntlClientProvider>
    </TestQueryProvider>,
  );
  return userEvent.setup();
}

const investorButton = () =>
  screen.getByRole("button", { name: /Ivy Investor/ });

describe("FundraisingBoard", () => {
  it("opens an investor from the keyboard and returns focus on close", async () => {
    const user = renderBoard();

    investorButton().focus();
    await user.keyboard("{Enter}");
    expect(
      await screen.findByRole("dialog", { name: "Ivy Investor" }),
    ).toBeTruthy();

    await user.keyboard("{Escape}");
    await waitFor(() => expect(document.activeElement).toBe(investorButton()));
  });

  it("returns focus to the Write draft button that opened the sheet", async () => {
    const user = renderBoard(
      testProspect({
        bestPath: {
          kind: "direct",
          via: { id: "me", name: "Me", image: null },
          linkedIn: false,
          through: null,
          company: null,
          strength: 50,
          touches: 3,
          lastTouchAt: null,
        },
      }),
    );
    const writeDraft = screen.getByRole("button", { name: "Write draft" });

    writeDraft.focus();
    await user.keyboard("{Enter}");
    await screen.findByRole("dialog", { name: "Ivy Investor" });
    await user.keyboard("{Escape}");

    await waitFor(() => expect(document.activeElement).toBe(writeDraft));
  });

  it("focuses the stage filter when the investor left the filtered board", async () => {
    service.updateProspect.mockImplementation(async () =>
      testProspect({ stage: "MEETING" }),
    );
    const user = renderBoard();
    await user.click(screen.getByRole("radio", { name: /To research/ }));

    investorButton().focus();
    await user.keyboard("{Enter}");
    const sheet = await screen.findByRole("dialog", { name: "Ivy Investor" });
    await user.click(within(sheet).getByRole("combobox", { name: "Stage" }));
    await user.click(await screen.findByRole("option", { name: "Meeting" }));
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: /Ivy Investor/ })).toBeNull(),
    );
    await user.keyboard("{Escape}");

    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("radio", { name: /To research/ }),
      ),
    );
  });

  it("folds suggestions into one bar until Review opens them", async () => {
    service.suggestions.mockResolvedValueOnce([
      testSuggestion(),
      testSuggestion({ id: "suggestion-2", name: "Rae Suggested" }),
    ]);
    const user = renderBoard();

    const review = await screen.findByRole("button", { name: "Review" });
    expect(screen.getByText("2 suggested investors")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Find investors/ })).toBeTruthy();
    expect(review.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("Sam Suggested")).toBeNull();
    expect(investorButton()).toBeTruthy();

    await user.click(review);

    expect(review.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("Sam Suggested")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Add" })).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Add all" })).toBeTruthy();
  });

  it("shows the reply state as plain text under the last touch", () => {
    renderBoard(
      testProspect({
        contact: testContact({
          lastContactAt: new Date(Date.now() - 30 * 86_400_000),
          replyState: "NO_REPLY",
          awaitingReplySince: new Date(Date.now() - 30 * 86_400_000),
        }),
      }),
    );

    expect(screen.getByText("No reply · 30d")).toBeTruthy();
  });

  it("moves focus to Find investors when the last suggestion goes, and keeps a new batch folded", async () => {
    service.suggestions
      .mockResolvedValueOnce([testSuggestion()])
      .mockResolvedValueOnce([
        testSuggestion({ id: "suggestion-2", name: "Rae Suggested" }),
      ]);
    service.find.mockResolvedValueOnce({
      found: 1,
      costUsd: 0.5,
      research: testPipeline().research,
    });
    const user = renderBoard();
    await user.click(await screen.findByRole("button", { name: "Review" }));

    screen.getByRole("button", { name: "Dismiss" }).focus();
    await user.keyboard("{Enter}");

    const find = screen.getByRole("button", { name: "Find investors" });
    await waitFor(() => expect(document.activeElement).toBe(find));
    expect(screen.queryByRole("button", { name: "Review" })).toBeNull();

    await user.click(find);
    await user.type(
      await screen.findByLabelText("Who are you looking for?"),
      "Seed investors in agent tooling",
    );
    await user.click(screen.getByRole("button", { name: /Search for/ }));

    const review = await screen.findByRole("button", { name: "Review" });
    expect(review.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("Rae Suggested")).toBeNull();
  });

  it("says why search is off at every width", () => {
    renderBoard(testProspect(), {
      research: { ...testPipeline().research, exaConfigured: false },
    });

    expect(screen.getByText("Search is off")).toBeTruthy();
  });
});
