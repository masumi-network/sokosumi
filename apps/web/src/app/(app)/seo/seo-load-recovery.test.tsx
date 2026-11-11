import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  render,
  renderHook,
  screen,
  within,
} from "@testing-library/react";
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
  seoTestObservation,
  seoTestWorkspace,
} from "./components/seo-test-fixture";
import { SeoWorkspace } from "./components/seo-workspace";
import { useSeoWorkspace } from "./components/use-seo-workspace";
import SeoPage from "./page";

const boundary = vi.hoisted(() => {
  const refresh = vi.fn();
  return {
    // One router for all renders, as in the app.
    router: { refresh },
    getWorkspace: vi.fn(),
    getAuditWorkspaceMapping: vi.fn(),
    getServerSession: vi.fn(),
    members: vi.fn(),
    listAudits: vi.fn(),
    refresh,
    session: {
      user: { id: "owner" },
      session: { activeOrganizationId: "org" },
    },
  };
});
vi.mock("next/server", async (original) => ({
  ...(await original<typeof import("next/server")>()),
  connection: async () => {},
}));
vi.mock("next/navigation", async (original) => ({
  ...(await original<typeof import("next/navigation")>()),
  useRouter: () => boundary.router,
}));
vi.mock("next-intl/server", () => ({
  getTranslations: async (namespace: "App.Seo" = "App.Seo") =>
    createTranslator({ locale: "en", messages, namespace }),
}));
vi.mock("@/lib/services/seo.service", () => ({
  seoService: {
    getWorkspace: boundary.getWorkspace,
    getAuditWorkspaceMapping: boundary.getAuditWorkspaceMapping,
    listAudits: boundary.listAudits,
  },
}));
vi.mock("@/lib/auth/auth.server", () => ({
  getSession: boundary.getServerSession,
}));
vi.mock("@/lib/services/user.service", () => ({
  userService: { getMyMembersWithOrganizations: boundary.members },
}));
vi.mock("@/lib/auth/auth.client", () => ({
  useSession: () => ({ data: boundary.session }),
}));

const clients: QueryClient[] = [];
const CACHED_AUDIT_NAME = "Previously visible audit";
const ACTIVE_ORGANIZATION = "org";
const OTHER_ORGANIZATION = "other-org";
const NOT_HERE_TITLE = "This audit is not available in this workspace";
const SWITCH_TITLE = "This audit is in another workspace";
function member(organizationId: string, name: string) {
  return { organizationId, organization: { id: organizationId, name } };
}
function auditIn(organizationId: string | null) {
  boundary.getAuditWorkspaceMapping.mockResolvedValue({
    name: "Battery audit",
    workspaceId: "workspace",
    organizationId,
  });
}
function auditMissingHere() {
  boundary.getWorkspace.mockRejectedValue(
    new CoreApiRequestError("SEO audit not found", { status: 404 }),
  );
}
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
  boundary.getAuditWorkspaceMapping.mockResolvedValue(null);
  boundary.getServerSession.mockResolvedValue({
    user: { id: "owner", name: "Owner", email: "owner@example.com" },
    session: { activeOrganizationId: ACTIVE_ORGANIZATION },
  });
  boundary.members.mockResolvedValue([
    member(ACTIVE_ORGANIZATION, "Acme"),
    member(OTHER_ORGANIZATION, "Globex"),
  ]);
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
  it("explains a 404 when no other workspace of the reader holds the Audit", async () => {
    auditMissingHere();
    await showPage({ auditId: SEO_TEST_AUDIT });
    expect(screen.getByRole("heading", { name: NOT_HERE_TITLE })).toBeVisible();
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(boundary.getAuditWorkspaceMapping).toHaveBeenCalledExactlyOnceWith(
      SEO_TEST_AUDIT,
    );
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

  it.each([
    [OTHER_ORGANIZATION, "Globex"],
    [null, "Personal account"],
  ])(
    "asks to switch when the Audit is in another workspace of the reader (%s)",
    async (organizationId, account) => {
      auditMissingHere();
      auditIn(organizationId);
      // A selected page travels with the link: the switch opens the same address.
      await showPage({ auditId: SEO_TEST_AUDIT, pageId: SEO_TEST_PAGE });
      const prompt = screen.getByRole("alertdialog", { name: SWITCH_TITLE });
      expect(prompt).toHaveTextContent(
        `"Battery audit" is in the ${account} workspace.`,
      );
      expect(
        within(prompt).getByLabelText(`From Acme to ${account}`),
      ).toBeVisible();
      expect(screen.queryByRole("alert")).toBeNull();
      expect(boundary.listAudits).not.toHaveBeenCalled();
    },
  );

  it("keeps the 404 text when the Audit is in the active workspace", async () => {
    auditMissingHere();
    auditIn(ACTIVE_ORGANIZATION);
    await showPage({ auditId: SEO_TEST_AUDIT });
    expect(screen.getByRole("heading", { name: NOT_HERE_TITLE })).toBeVisible();
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("asks to switch when the reader has no seat in the active workspace", async () => {
    // Core refuses the seat before it looks for the Audit, so 403 does not say where the Audit is.
    auditIn(OTHER_ORGANIZATION);
    boundary.getWorkspace.mockRejectedValue(
      new CoreApiRequestError("Seat required", { status: 403 }),
    );
    await showPage({ auditId: SEO_TEST_AUDIT });
    expect(
      screen.getByRole("alertdialog", { name: SWITCH_TITLE }),
    ).toBeVisible();
  });

  it("does not look in other workspaces after an upstream failure or for a Project", async () => {
    auditIn(OTHER_ORGANIZATION);
    boundary.getWorkspace.mockRejectedValue(
      new CoreApiRequestError("Upstream failed", { status: 500 }),
    );
    await showPage({ auditId: SEO_TEST_AUDIT });
    auditMissingHere();
    await showPage({ projectId: SEO_TEST_AUDIT, view: "project" });
    expect(boundary.getAuditWorkspaceMapping).not.toHaveBeenCalled();
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("keeps the 404 text when the reader's organizations cannot be read", async () => {
    auditMissingHere();
    auditIn(OTHER_ORGANIZATION);
    boundary.members.mockRejectedValue(
      new CoreApiRequestError("Upstream failed", { status: 500 }),
    );
    await showPage({ auditId: SEO_TEST_AUDIT });
    expect(screen.getByRole("heading", { name: NOT_HERE_TITLE })).toBeVisible();
    expect(screen.queryByRole("alertdialog")).toBeNull();
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

  it("asks once for the conversation when Core refuses it, and keeps the Agent tab", async () => {
    const checked = workspace();
    checked.observations = [seoTestObservation(checked)];
    const chatReads = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (!url.endsWith("/chat")) return Response.json(checked);
        chatReads();
        return new Response(null, { status: 500 });
      }),
    );
    render(wrap(<SeoWorkspace workspace={checked} />, client()));
    expect(await screen.findByLabelText("Your question")).toBeVisible();
    await vi.waitFor(() => expect(chatReads).toHaveBeenCalled());
    // Time for a retry to start: this client waits 0 ms between tries.
    await act(() => new Promise((resolve) => setTimeout(resolve, 50)));
    expect(chatReads).toHaveBeenCalledOnce();
    expect(screen.getByLabelText("Your question")).toBeVisible();
  });

  it.each([
    [404, "audit", 1],
    [403, "audit", 1],
    // This tab still names the workspace that the reader left in another tab.
    [409, "audit", 1],
    [401, "audit", 0],
    [503, "audit", 0],
    [404, "project", 0],
  ] as const)(
    "loads the page again after a workspace change and a client %i for the %s: %i time",
    async (status, kind, times) => {
      const data = kind === "audit" ? workspace() : seoTestWorkspace();
      const value = client();
      const view = render(wrap(<SeoWorkspace workspace={data} />, value));
      await screen.findByRole("tab", { name: "Agent" });
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => Response.json({ error: "SEO failed" }, { status })),
      );
      boundary.session = {
        user: { id: "owner" },
        session: { activeOrganizationId: OTHER_ORGANIZATION },
      };
      view.rerender(wrap(<SeoWorkspace workspace={data} />, value));
      // The error view replaces the Audit. Only the page can ask to switch.
      expect(
        await screen.findByRole("link", { name: "All audits" }),
      ).toBeVisible();
      expect(screen.queryByRole("tab", { name: "Agent" })).toBeNull();
      view.rerender(wrap(<SeoWorkspace workspace={data} />, value));
      expect(boundary.refresh).toHaveBeenCalledTimes(times);
    },
  );

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
