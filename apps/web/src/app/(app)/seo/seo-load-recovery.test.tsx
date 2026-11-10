import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, renderHook, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createTranslator, NextIntlClientProvider } from "next-intl";
import { NuqsTestingAdapter } from "nuqs/adapters/testing";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFormats } from "@/i18n/time-format";
import { CoreApiRequestError } from "@/lib/clients/core.request";
import messages from "../../../../messages/en.json";
import {
  SEO_TEST_AUDIT,
  SEO_TEST_PAGE,
  seoTestWorkspace,
} from "./components/seo-test-fixture";
import { SeoWorkspace } from "./components/seo-workspace";
import { useSeoWorkspace } from "./components/use-seo-workspace";
import SeoPage from "./page";

const boundary = vi.hoisted(() => ({
  getWorkspace: vi.fn(),
  listAudits: vi.fn(),
  refresh: vi.fn(),
  session: { user: { id: "owner" }, session: { activeOrganizationId: "org" } },
}));
vi.mock("next/server", async (original) => ({
  ...(await original<typeof import("next/server")>()),
  connection: async () => {},
}));
vi.mock("next/navigation", async (original) => ({
  ...(await original<typeof import("next/navigation")>()),
  useRouter: () => ({ refresh: boundary.refresh }),
}));
vi.mock("next-intl/server", () => ({
  getTranslations: async () =>
    createTranslator({ locale: "en", messages, namespace: "App.Seo" }),
}));
vi.mock("@/lib/services/seo.service", () => ({
  seoService: {
    getWorkspace: boundary.getWorkspace,
    listAudits: boundary.listAudits,
  },
}));
vi.mock("@/lib/auth/auth.client", () => ({
  useSession: () => ({ data: boundary.session }),
}));

const clients: QueryClient[] = [];
const CACHED_AUDIT_NAME = "Previously visible audit";
function wrap(children: ReactNode, client: QueryClient) {
  return (
    <QueryClientProvider client={client}>
      <NextIntlClientProvider
        locale="en"
        timeZone="UTC"
        formats={createFormats()}
        messages={messages}
      >
        <NuqsTestingAdapter hasMemory>{children}</NuqsTestingAdapter>
      </NextIntlClientProvider>
    </QueryClientProvider>
  );
}
function client() {
  const value = new QueryClient({
    defaultOptions: { queries: { retryDelay: 0 } },
  });
  clients.push(value);
  return value;
}
async function showPage(params: Record<string, string>) {
  const page = await SeoPage({ searchParams: Promise.resolve(params) });
  return render(wrap(page, client()));
}
function workspace() {
  return {
    ...seoTestWorkspace(),
    projectId: null,
    auditId: SEO_TEST_AUDIT,
    auditName: CACHED_AUDIT_NAME,
  };
}
beforeEach(() => {
  vi.clearAllMocks();
  boundary.session = {
    user: { id: "owner" },
    session: { activeOrganizationId: "org" },
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json(workspace())),
  );
});
afterEach(() => {
  clients.splice(0).forEach((item) => item.clear());
  vi.unstubAllGlobals();
});

describe("SEO load recovery", () => {
  it("explains a wrong-Workspace 404 without discovering or switching another Workspace", async () => {
    boundary.getWorkspace.mockRejectedValue(
      new CoreApiRequestError("SEO audit not found", { status: 404 }),
    );
    await showPage({ auditId: SEO_TEST_AUDIT });
    expect(
      screen.getByRole("heading", {
        name: "This audit is not available in this workspace",
      }),
    ).toBeVisible();
    expect(
      screen.getByText(/It may belong to another workspace/),
    ).toBeVisible();
    expect(screen.getByRole("link", { name: "All audits" })).toHaveAttribute(
      "href",
      "/seo",
    );
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
    expect(boundary.getWorkspace).toHaveBeenCalledExactlyOnceWith(
      { kind: "audit", id: SEO_TEST_AUDIT },
      {},
    );
    expect(boundary.listAudits).not.toHaveBeenCalled();
  });

  it.each(["pageId", "scopeId"])(
    "offers an explicit all-pages reset after a stale %s 404",
    async (selection) => {
      boundary.getWorkspace.mockRejectedValue(
        new CoreApiRequestError("Selection unavailable", { status: 404 }),
      );
      await showPage({ auditId: SEO_TEST_AUDIT, [selection]: SEO_TEST_PAGE });
      expect(
        screen.getByRole("link", { name: "Open all pages" }),
      ).toHaveAttribute("href", `/seo?auditId=${SEO_TEST_AUDIT}`);
      // The link opens this Audit here, so the text does not send the reader to another workspace.
      expect(
        screen.getByText(/This audit or selection is not available/),
      ).toBeVisible();
      expect(boundary.getWorkspace).toHaveBeenCalledOnce();
      expect(boundary.listAudits).not.toHaveBeenCalled();
    },
  );

  it("keeps explicit refresh available for a true upstream failure", async () => {
    boundary.getWorkspace.mockRejectedValue(
      new CoreApiRequestError("Upstream unavailable", { status: 503 }),
    );
    await showPage({ auditId: SEO_TEST_AUDIT });
    expect(
      screen.getByRole("heading", { name: "Failed to load SEO" }),
    ).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(boundary.refresh).toHaveBeenCalledOnce();
  });

  it("preserves a client 404 and hides previously cached Audit content", async () => {
    const read = vi.fn(async (_url: string) =>
      Response.json({ error: "SEO unavailable" }, { status: 404 }),
    );
    vi.stubGlobal("fetch", read);
    render(wrap(<SeoWorkspace workspace={workspace()} />, client()));
    expect(
      await screen.findByRole("heading", {
        name: "This audit is not available in this workspace",
      }),
    ).toBeVisible();
    expect(screen.queryByText(CACHED_AUDIT_NAME)).toBeNull();
    expect(screen.queryByRole("tab", { name: "Overview" })).toBeNull();
    expect(
      read.mock.calls.filter(([url]) =>
        url.startsWith(`/api/seo/audits/${SEO_TEST_AUDIT}`),
      ),
    ).toHaveLength(1);
  });

  it("stops running-analysis polling after the Audit becomes unavailable", async () => {
    vi.useFakeTimers();
    try {
      const data = workspace();
      data.analyses = [
        {
          id: "49b8d24c-2969-4ca0-aeef-343b9dba2383",
          kind: "page_check",
          status: "running",
          taskId: "task",
          pageIds: [SEO_TEST_PAGE],
          scopeVersion: 1,
          createdAt: new Date("2026-01-01T12:00:00Z"),
        },
      ];
      const read = vi.fn(async () =>
        Response.json({ error: "SEO unavailable" }, { status: 404 }),
      );
      vi.stubGlobal("fetch", read);
      const queryClient = client();
      const { result } = renderHook(() => useSeoWorkspace(data).result.error, {
        wrapper: ({ children }) => wrap(children, queryClient),
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1);
      });
      expect(result.current).toMatchObject({ status: 404 });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(31_000);
      });
      expect(read).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it("hides the previous Audit while a changed Workspace request is pending", async () => {
    const value = client();
    const view = render(wrap(<SeoWorkspace workspace={workspace()} />, value));
    expect(await screen.findByText(CACHED_AUDIT_NAME)).toBeVisible();
    let finish: ((response: Response) => void) | undefined;
    const waiting = new Promise<Response>((resolve) => {
      finish = resolve;
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(() => waiting),
    );
    boundary.session = {
      user: { id: "owner" },
      session: { activeOrganizationId: "another-org" },
    };
    view.rerender(wrap(<SeoWorkspace workspace={workspace()} />, value));
    expect(screen.queryByText(CACHED_AUDIT_NAME)).toBeNull();
    finish?.(Response.json({ error: "SEO unavailable" }, { status: 404 }));
    expect(
      await screen.findByRole("heading", {
        name: "This audit is not available in this workspace",
      }),
    ).toBeVisible();
  });
});
