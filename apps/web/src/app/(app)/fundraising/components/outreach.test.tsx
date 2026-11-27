import type {
  FundraisingPaths,
  FundraisingPipeline,
  FundraisingProspect,
} from "@sokosumi/core-client";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";
import en from "@/messages/en.json";
import { TestQueryProvider } from "@/test/query-provider";
import { Outreach } from "./outreach";

const service = vi.hoisted(() => ({ paths: vi.fn(), draft: vi.fn() }));

vi.mock("@/lib/services/fundraising.client", () => ({
  fundraisingService: service,
}));
vi.mock("@/lib/auth/auth.client", () => ({
  useSession: () => ({
    data: { session: { activeOrganizationId: "org-1" }, user: { id: "me" } },
  }),
}));

const prospect = {
  contact: {
    id: "investor-1",
    name: "Ivy Investor",
    channels: [],
    lastContactAt: null,
  },
  dataRoom: null,
  lastDraftAt: null,
} as unknown as FundraisingProspect;

const pipeline = {
  rooms: [],
  mailbox: { provider: "Gmail", botId: "bot-1" },
} as unknown as FundraisingPipeline;

const paths = {
  paths: [
    {
      kind: "fund",
      via: { id: "teammate-1", name: "Tess", image: null },
      linkedIn: false,
      through: {
        id: "connector-1",
        name: "Lukas Link",
        role: null,
        organization: "Fund",
        avatarUrl: null,
        email: "lukas@example.com",
      },
      company: { name: "Fund", round: null, date: null },
      strength: 60,
      touches: 4,
      lastTouchAt: null,
    },
  ],
} as unknown as FundraisingPaths;

describe("Outreach", () => {
  it("offers the intro paths that load after the sheet opens", async () => {
    const loaded = Promise.withResolvers<FundraisingPaths>();
    service.paths.mockReturnValue(loaded.promise);
    const user = userEvent.setup();
    render(
      <TestQueryProvider>
        <NextIntlClientProvider locale="en" messages={en}>
          <Outreach prospect={prospect} pipeline={pipeline} now={new Date()} />
        </NextIntlClientProvider>
      </TestQueryProvider>,
    );

    await act(async () => loaded.resolve(paths));
    await user.click(screen.getByRole("combobox", { name: "Through whom" }));

    expect(
      await screen.findByRole("option", {
        name: "Ask Lukas Link for an intro",
      }),
    ).toBeTruthy();
  });
});
