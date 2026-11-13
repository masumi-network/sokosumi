import type { ProjectSeoWorkspace } from "@sokosumi/core-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { NuqsTestingAdapter } from "nuqs/adapters/testing";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFormats } from "@/i18n/time-format";
import messages from "../../../../../messages/en.json";
import { seoTestCheckedAudit, seoTestMetric } from "./seo-test-fixture";
import { SeoWorkspace } from "./seo-workspace";

vi.mock("@/app/chat/actions", () => ({
  ensureSokoBotDirectRoomAction: vi.fn(),
}));
vi.mock("next/navigation", async () => ({
  ...(await vi.importActual<typeof import("next/navigation")>(
    "next/navigation",
  )),
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock("@/lib/actions/seo/action", () => ({ mutateSeo: vi.fn() }));
vi.mock("@/lib/auth/auth.client", () => ({
  useSession: () => ({
    data: { session: { activeOrganizationId: "org" }, user: { id: "owner" } },
  }),
}));

function renderImprove(workspace: ProjectSeoWorkspace) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) =>
      url.endsWith("/chat")
        ? Response.json({ sharing: "personal", turns: [] })
        : Response.json(workspace),
    ),
  );
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <NextIntlClientProvider
        locale="en"
        timeZone="UTC"
        formats={createFormats()}
        messages={messages}
      >
        <NuqsTestingAdapter searchParams="tab=improve" hasMemory>
          <SeoWorkspace workspace={workspace} />
        </NuqsTestingAdapter>
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("SEO Improve tab", () => {
  it("lists missing features, what the audit could not see, and the steps that unlock them", async () => {
    const user = userEvent.setup();
    const workspace = seoTestCheckedAudit();
    workspace.metrics = [seoTestMetric()];
    renderImprove(workspace);
    expect(
      await screen.findByRole("tab", { name: "Improve", selected: true }),
    ).toBeVisible();
    expect(
      screen.getByRole("heading", { name: "What the agent cannot do yet" }),
    ).toBeVisible();
    // Built in this tab's own release: not listed as missing.
    expect(screen.queryByText("Google update markers on charts")).toBeNull();
    expect(screen.getByText("Full-site crawl")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Missing" }));
    expect(screen.queryByText("Full-site crawl")).toBeNull();
    expect(screen.getByText("Orphan pages")).toBeVisible();

    // Search Console is synced, Google Analytics is not: one gap, and its step offers the connection.
    const gaps = screen
      .getByRole("heading", { name: "What this audit could not see" })
      .closest("section") as HTMLElement;
    expect(within(gaps).getByText(/^No Google Analytics data/)).toBeVisible();
    expect(within(gaps).queryByText(/^No Search Console data/)).toBeNull();
    const steps = screen
      .getByRole("heading", { name: "How to get it improved" })
      .closest("section") as HTMLElement;
    expect(within(steps).getByText("Done")).toBeVisible();
    expect(
      within(steps).getByRole("button", { name: "Connect Google Analytics" }),
    ).toBeVisible();
  });

  it("asks the agent with a prepared question and copies a request", async () => {
    const user = userEvent.setup();
    renderImprove(seoTestCheckedAudit());
    const write = vi.spyOn(navigator.clipboard, "writeText");
    await user.click(
      await screen.findByRole("button", {
        name: "Copy request: Orphan pages",
      }),
    );
    expect(write).toHaveBeenCalledWith(
      "Feature request for the SEO agent, item 4: Orphan pages. What is missing: No list of pages that no other page links to.",
    );
    await user.click(
      screen.getByRole("button", { name: "Ask the agent: Orphan pages" }),
    );
    // The reader reviews the question before it is sent.
    expect(
      within(await screen.findByRole("dialog")).getByLabelText("Your question"),
    ).toHaveValue(
      "The SEO tab cannot do this yet: Orphan pages. No list of pages that no other page links to. What can I do now with the data I have?",
    );
  });
});
