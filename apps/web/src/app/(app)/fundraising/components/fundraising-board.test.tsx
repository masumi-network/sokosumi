import type { FundraisingProspect } from "@sokosumi/core-client";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";
import {
  testPipeline,
  testProspect,
} from "@/app/fundraising/fundraising-fixtures";
import en from "@/messages/en.json";
import { TestQueryProvider } from "@/test/query-provider";
import { FundraisingBoard } from "./fundraising-board";

const service = vi.hoisted(() => {
  const never = () => new Promise<never>(() => {});
  return {
    pipeline: never,
    suggestions: async () => [],
    paths: never,
    updateProspect: vi.fn(),
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

function renderBoard(prospect: FundraisingProspect = testProspect()) {
  render(
    <TestQueryProvider>
      <NextIntlClientProvider locale="en" messages={en}>
        <FundraisingBoard
          initialData={testPipeline({ prospects: [prospect] })}
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
});
