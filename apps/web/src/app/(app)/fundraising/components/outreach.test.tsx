import type { FundraisingPaths } from "@sokosumi/core-client";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";
import {
  testFundPath,
  testPaths,
  testPipeline,
  testProspect,
} from "@/app/fundraising/fundraising-fixtures";
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

const prospect = testProspect();
const pipeline = testPipeline({
  mailbox: { provider: "Gmail", botId: "bot-1" },
});

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

    await act(async () => loaded.resolve(testPaths([testFundPath()])));
    await user.click(screen.getByRole("combobox", { name: "Through whom" }));

    expect(
      await screen.findByRole("option", {
        name: "Ask Casey Connector for an intro",
      }),
    ).toBeTruthy();
  });
});
