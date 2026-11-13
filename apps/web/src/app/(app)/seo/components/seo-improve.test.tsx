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

function renderImprove(workspace: ProjectSeoWorkspace, searchParams = "") {
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
        <NuqsTestingAdapter searchParams={searchParams} hasMemory>
          <SeoWorkspace workspace={workspace} />
        </NuqsTestingAdapter>
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

async function openImprove(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("button", { name: "Manage SEO" }));
  await user.click(
    await screen.findByRole("menuitem", {
      name: "What the agent cannot do yet",
    }),
  );
  return within(await screen.findByRole("dialog"));
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("What the agent cannot do yet", () => {
  it("opens from the header menu with the open items and what the audit could not see", async () => {
    const user = userEvent.setup();
    const workspace = seoTestCheckedAudit();
    workspace.metrics = [seoTestMetric()];
    renderImprove(workspace);
    const dialog = await openImprove(user);
    // Built already: not listed as missing.
    expect(dialog.queryByText("Google update markers on charts")).toBeNull();
    expect(dialog.getByText("Full-site crawl")).toBeVisible();
    expect(dialog.getByText("Site migration check")).toBeVisible();
    // Search Console is synced, Google Analytics is not: one gap, with the words of the Traffic tab's button.
    expect(dialog.getByText(/^No Google Analytics data/)).toBeVisible();
    expect(dialog.queryByText(/^No Search Console data/)).toBeNull();
    expect(
      dialog.getByRole("button", {
        name: "Set up statistics: Google Analytics",
      }),
    ).toBeVisible();
    // What the owner can change now leads the dialog.
    expect(dialog.getAllByRole("heading", { level: 3 })[0]).toHaveTextContent(
      "What this audit could not see",
    );
  });

  it("copies a request for one item", async () => {
    const user = userEvent.setup();
    renderImprove(seoTestCheckedAudit());
    const dialog = await openImprove(user);
    const write = vi.spyOn(navigator.clipboard, "writeText");
    await user.click(
      dialog.getByRole("button", {
        name: "Copy request: Site migration check",
      }),
    );
    expect(write).toHaveBeenCalledWith(
      "Feature request for the SEO agent, item 7: Site migration check. What is missing: No check of the redirects of a domain or URL move.",
    );
  });

  it("opens the Agent tab from a link saved when Improve was a tab", async () => {
    renderImprove(seoTestCheckedAudit(), "tab=improve");
    expect(
      await screen.findByRole("tab", { name: "Agent", selected: true }),
    ).toBeVisible();
    expect(screen.queryByRole("tab", { name: "Improve" })).toBeNull();
  });
});
