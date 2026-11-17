import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { NuqsTestingAdapter } from "nuqs/adapters/testing";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import messages from "../../../../../messages/en.json";
import { seoTestKeyword, seoTestWorkspace } from "./seo-test-fixture";
import { useSeoStatistics } from "./use-seo-statistics";
import { useSeoWorkspace } from "./use-seo-workspace";

const { mutate, collect } = vi.hoisted(() => ({
  mutate: vi.fn(),
  collect: vi.fn(),
}));
vi.mock("@/lib/actions/seo/action", () => ({ mutateSeo: mutate }));
vi.mock("@/lib/auth/auth.client", () => ({
  useSession: () => ({
    data: { session: { activeOrganizationId: "org" }, user: { id: "owner" } },
  }),
}));
const clients: QueryClient[] = [];
let connected = true;
let analyticsConnected = false;
let propertyRows = [{ id: "sc-domain:example.com", name: "Example" }];
let workspace = seoTestWorkspace();
function mount(settings = false) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  clients.push(client);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <NextIntlClientProvider locale="en" timeZone="UTC" messages={messages}>
        <NuqsTestingAdapter hasMemory>{children}</NuqsTestingAdapter>
      </NextIntlClientProvider>
    </QueryClientProvider>
  );
  return {
    client,
    ...renderHook(
      () => {
        const model = useSeoWorkspace(workspace);
        const form = useSeoStatistics(
          model,
          settings ? "ga4" : "search_console",
        );
        return { ...model, form };
      },
      { wrapper },
    ),
  };
}
beforeEach(() => {
  connected = true;
  analyticsConnected = false;
  propertyRows = [{ id: "sc-domain:example.com", name: "Example" }];
  workspace = seoTestWorkspace();
  collect.mockReset().mockImplementation(async () => Response.json(null));
  mutate.mockReset().mockResolvedValue({ ok: true, value: null });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init?: RequestInit) => {
      const url = new URL(input, "https://web.test");
      if (url.pathname.endsWith("/statistics") && init?.method === "POST")
        return collect(input, init);
      if (url.pathname.includes("/connections/")) {
        const provider = url.pathname.split("/").at(-1);
        return Response.json({
          provider,
          name: provider,
          source: "native",
          status:
            (provider === "search_console" && connected) ||
            (provider === "ga4" && analyticsConnected)
              ? "connected"
              : "not_connected",
        });
      }
      if (url.pathname.endsWith("/statistics/properties"))
        return Response.json({
          provider: url.searchParams.get("provider"),
          status: "available",
          properties: propertyRows,
          reason: null,
        });
      const pageId = url.searchParams.get("pageId");
      return Response.json(
        pageId
          ? {
              ...workspace,
              scope: { ...workspace.scope, id: null, pageIds: [pageId] },
            }
          : workspace,
      );
    }),
  );
});
afterEach(() => {
  cleanup();
  for (const client of clients.splice(0)) client.clear();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("automatic Google statistics", () => {
  it("collects the first 90 days for the active pages without a Sync action", async () => {
    mount();
    await waitFor(() => expect(collect).toHaveBeenCalledOnce());
    const request = {
      command: {
        kind: "sync_statistics",
        body: JSON.parse(collect.mock.calls[0][1].body),
      },
    };
    expect(request.command).toMatchObject({
      kind: "sync_statistics",
      body: {
        automatic: true,
        provider: "search_console",
        propertyId: "sc-domain:example.com",
        channel: "organic",
        scopeId: workspace.scope.id,
        expectedScopeVersion: workspace.scope.version,
      },
    });
    const { from, to } = request.command.body;
    expect((Date.parse(to) - Date.parse(from)) / 86_400_000 + 1).toBe(90);
    const yesterday = new Date();
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    expect(to).toBe(yesterday.toISOString().slice(0, 10));
  });

  it("starts collection when Google connects after the workspace mounted", async () => {
    connected = false;
    const { client } = mount();
    await waitFor(() =>
      expect(
        client.getQueryData([
          "seo-connection",
          "org",
          "owner",
          "search_console",
        ]),
      ).toMatchObject({ status: "not_connected" }),
    );
    expect(collect).not.toHaveBeenCalled();
    await act(async () => {
      connected = true;
      await client.invalidateQueries({
        queryKey: ["seo-connection", "org", "owner", "search_console"],
      });
    });
    await waitFor(() => expect(collect).toHaveBeenCalledOnce());
  });

  it("does not guess an unrelated Search Console property", async () => {
    propertyRows = [{ id: "sc-domain:unrelated.example", name: "Other" }];
    const { client } = mount();
    await waitFor(() =>
      expect(
        client.getQueryData([
          "seo-connection",
          "org",
          "owner",
          "search_console",
        ]),
      ).toMatchObject({ status: "connected" }),
    );
    await act(async () => {});
    expect(collect).not.toHaveBeenCalled();
  });

  it("does not collect private data when this viewer cannot sync metrics", async () => {
    workspace.availableActions.canSyncMetrics = false;
    mount();
    await act(async () => {});
    expect(collect).not.toHaveBeenCalled();
  });
  it("collects after an ambiguous Analytics property is chosen without a submit button", async () => {
    connected = false;
    analyticsConnected = true;
    propertyRows = [
      { id: "properties/1", name: "First" },
      { id: "properties/2", name: "Second" },
    ];
    const { result } = mount(true);
    await waitFor(() =>
      expect(result.current.form.properties.data?.properties).toHaveLength(2),
    );
    expect(collect).not.toHaveBeenCalled();
    act(() => result.current.form.setPropertyId("properties/2"));
    await waitFor(() => expect(collect).toHaveBeenCalledOnce());
    expect(JSON.parse(collect.mock.calls[0][1].body)).toMatchObject({
      provider: "ga4",
      propertyId: "properties/2",
      automatic: true,
    });
  });

  it("collects a new page selection instead of reusing the whole audit request", async () => {
    const secondId = "10a13a90-4f3e-43be-8876-080733e42253";
    workspace.pages.push({
      ...workspace.pages[0],
      id: secondId,
      url: "https://example.com/about",
    });
    const { result } = mount();
    await waitFor(() => expect(collect).toHaveBeenCalledOnce());
    await act(async () => {
      await result.current.setFilters({ pageId: secondId });
    });
    await waitFor(() => expect(collect).toHaveBeenCalledTimes(2));
    expect(JSON.parse(collect.mock.calls[1][1].body)).toMatchObject({
      pageIds: [secondId],
      automatic: true,
    });
    expect(JSON.parse(collect.mock.calls[1][1].body).scopeId).toBeUndefined();
  });
  it("quietly retries a busy collector instead of requiring the user to Sync", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    collect
      .mockResolvedValueOnce(new Response(null, { status: 409 }))
      .mockImplementation(async () => Response.json(null));
    const { result } = mount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(collect).toHaveBeenCalledOnce();
    expect(result.current.statisticsSync.state).toBe("loading");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });
    expect(collect).toHaveBeenCalledTimes(2);
    expect(result.current.statisticsSync.state).toBe("idle");
  });

  it("reactivates a previous property selection through the authoritative Core cache", async () => {
    connected = false;
    analyticsConnected = true;
    propertyRows = [
      { id: "properties/1", name: "First" },
      { id: "properties/2", name: "Second" },
    ];
    const { result } = mount(true);
    await waitFor(() =>
      expect(result.current.form.properties.data?.properties).toHaveLength(2),
    );
    act(() => result.current.form.setPropertyId("properties/1"));
    await waitFor(() => expect(collect).toHaveBeenCalledTimes(1));
    act(() => result.current.form.setPropertyId("properties/2"));
    await waitFor(() => expect(collect).toHaveBeenCalledTimes(2));
    act(() => result.current.form.setPropertyId("properties/1"));
    await waitFor(() => expect(collect).toHaveBeenCalledTimes(3));
    expect(
      collect.mock.calls.map((call) => JSON.parse(call[1].body).propertyId),
    ).toEqual(["properties/1", "properties/2", "properties/1"]);
  });
  it("retries the failed collection when Retry is selected", async () => {
    collect
      .mockResolvedValueOnce(new Response(null, { status: 502 }))
      .mockImplementation(async () => Response.json(null));
    const { result } = mount();
    await waitFor(() =>
      expect(result.current.statisticsSync.state).toBe("failed"),
    );
    act(() => result.current.statisticsSync.retry());
    await waitFor(() => expect(collect).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(result.current.statisticsSync.state).toBe("idle"),
    );
  });

  it("keeps page edits responsive while a Google collection is still pending", async () => {
    collect.mockImplementation(() => new Promise(() => {}));
    const { result } = mount();
    await waitFor(() => expect(collect).toHaveBeenCalledOnce());
    await act(async () => {
      expect(
        await result.current.execute({
          kind: "save_brand_terms",
          body: { terms: ["Example"] },
        }),
      ).toBe(true);
    });
    expect(mutate).toHaveBeenCalledOnce();
  });
  it("collects series for a newly saved keyword without waiting for a window focus", async () => {
    const { result } = mount();
    await waitFor(() => expect(collect).toHaveBeenCalledOnce());
    workspace = {
      ...workspace,
      keywords: [seoTestKeyword({ keyword: "new query", saved: true })],
    };
    await act(async () => {
      await result.current.result.refetch();
    });
    await waitFor(() => expect(collect).toHaveBeenCalledTimes(2));
  });
});
