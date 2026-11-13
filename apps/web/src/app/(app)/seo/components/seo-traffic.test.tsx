import type { ProjectSeoWorkspace } from "@sokosumi/core-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { NuqsTestingAdapter } from "nuqs/adapters/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFormats } from "@/i18n/time-format";
import messages from "../../../../../messages/en.json";
import { seoTestMetric, seoTestWorkspace } from "./seo-test-fixture";
import { SeoWorkspace } from "./seo-workspace";

const { mutate } = vi.hoisted(() => ({ mutate: vi.fn() }));
vi.mock("@/lib/actions/seo/action", () => ({ mutateSeo: mutate }));
vi.mock("@/lib/auth/auth.client", () => ({
  useSession: () => ({
    data: { session: { activeOrganizationId: "org" }, user: { id: "owner" } },
  }),
}));
vi.mock("next/navigation", async () => ({
  ...(await vi.importActual<typeof import("next/navigation")>(
    "next/navigation",
  )),
  useRouter: () => ({ push: vi.fn() }),
}));

const clients: QueryClient[] = [];
function renderTraffic(workspace: ProjectSeoWorkspace, searchParams = "") {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 0 } },
  });
  clients.push(client);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json(workspace)),
  );
  return render(
    <QueryClientProvider client={client}>
      <NextIntlClientProvider
        locale="en"
        timeZone="UTC"
        formats={createFormats()}
        messages={messages}
      >
        <NuqsTestingAdapter
          searchParams={`?tab=traffic${searchParams}`}
          hasMemory
        >
          <SeoWorkspace workspace={workspace} />
        </NuqsTestingAdapter>
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}
beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => {
  cleanup();
  for (const client of clients.splice(0)) client.clear();
  vi.unstubAllGlobals();
});

describe("SEO Traffic search type", () => {
  it("reads the chosen Search Console search type and offers no choice without Search Console data", async () => {
    const user = userEvent.setup();
    const workspace = seoTestWorkspace();
    workspace.metrics = [{ ...seoTestMetric(), searchType: "web" }];
    renderTraffic(workspace);
    const choice = screen.getByRole("combobox", { name: "Search type" });
    expect(choice).toHaveTextContent("Web");
    await user.click(choice);
    await user.click(screen.getByRole("option", { name: "Discover" }));
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining("searchType=discover"),
        expect.anything(),
      ),
    );
    cleanup();
    const analytics = seoTestWorkspace();
    analytics.metrics = [{ ...seoTestMetric(), source: "ga4" }];
    renderTraffic(analytics);
    expect(screen.queryByRole("combobox", { name: "Search type" })).toBeNull();
  });

  it("refreshes the search type in view", async () => {
    const user = userEvent.setup();
    mutate.mockResolvedValue({ ok: true, value: null });
    const workspace = seoTestWorkspace();
    workspace.metrics = [{ ...seoTestMetric(), searchType: "discover" }];
    renderTraffic(workspace, "&searchType=discover");
    // The totals card and the empty query table each offer the same refresh.
    await user.click(screen.getAllByRole("button", { name: "Sync now" })[0]);
    await waitFor(() =>
      expect(mutate).toHaveBeenCalledWith(
        expect.objectContaining({
          command: expect.objectContaining({
            kind: "sync_statistics",
            body: expect.objectContaining({ searchType: "discover" }),
          }),
        }),
      ),
    );
  });
});
