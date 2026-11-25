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
        new QueryClient({
          defaultOptions: {
            queries: { retry: false, gcTime: Number.POSITIVE_INFINITY },
            mutations: { gcTime: Number.POSITIVE_INFINITY },
          },
        })
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
      name: "What the SEO agent can do",
    }),
  );
  return within(await screen.findByRole("dialog"));
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("What the SEO agent can do", () => {
  it("shows five short customer-facing limits and the audit data that is missing", async () => {
    const user = userEvent.setup();
    const workspace = seoTestCheckedAudit();
    workspace.metrics = [seoTestMetric()];
    renderImprove(workspace);
    const dialog = await openImprove(user);
    // Built already: not listed as missing.
    expect(dialog.queryByText("Google update markers on charts")).toBeNull();
    expect(dialog.queryByText("Full-site crawl")).toBeNull();
    expect(dialog.queryByText("Site migration check")).toBeNull();
    const summary = dialog
      .getByRole("heading", { name: "What you handle" })
      .closest("section");
    expect(summary).not.toBeNull();
    expect(
      within(summary as HTMLElement).getAllByRole("listitem"),
    ).toHaveLength(5);
    expect(
      dialog.getByText("Apply edits, run a follow-up check and share reports."),
    ).toBeVisible();
    // Search Console is synced, Google Analytics is not: one gap, with the words of the Traffic tab's button.
    expect(dialog.getByText(/^No Google Analytics data/)).not.toBeVisible();
    await user.click(dialog.getByText("Gaps in this audit"));
    expect(dialog.getByText(/^No Google Analytics data/)).toBeVisible();
    expect(dialog.queryByText(/^No Search Console data/)).toBeNull();
    expect(
      dialog.getByRole("button", {
        name: "Set up statistics: Google Analytics",
      }),
    ).toBeVisible();
    // What the owner can change now leads the dialog.
    expect(dialog.getAllByRole("heading", { level: 3 })[0]).toHaveTextContent(
      "What it checks",
    );
  });

  it("condenses collection failures without exposing provider errors or module names", async () => {
    const user = userEvent.setup();
    const workspace = seoTestCheckedAudit();
    workspace.metrics = [
      {
        ...seoTestMetric(),
        notes: [
          "GOOGLE_SEARCH_CONSOLE_INSPECT_URL: GET /internal/route returned HTTP 500",
          "Private provider error details",
        ],
      },
    ];
    workspace.observations[0].coverage = {
      checked: 12,
      skipped: 1,
      failed: 1,
      modules: {
        notRequested: 1,
        failed: 1,
        notRequestedNames: ["internal_module"],
        failedNames: ["another_internal_module"],
      },
    };
    renderImprove(workspace);
    const dialog = await openImprove(user);
    expect(
      dialog.getAllByText(/^Some Google statistics are missing/),
    ).toHaveLength(1);
    expect(
      dialog.getAllByText(/^Some checks did not return a result/),
    ).toHaveLength(1);
    expect(
      dialog.queryByText(
        /internal_module|HTTP 500|GOOGLE_SEARCH|Private provider/,
      ),
    ).toBeNull();
    expect(dialog.queryByRole("button", { name: /^Copy request/ })).toBeNull();
  });

  it("opens the Agent tab from a link saved when Improve was a tab", async () => {
    renderImprove(seoTestCheckedAudit(), "tab=improve");
    expect(
      await screen.findByRole("tab", { name: "Agent", selected: true }),
    ).toBeVisible();
    expect(screen.queryByRole("tab", { name: "Improve" })).toBeNull();
  });
});
