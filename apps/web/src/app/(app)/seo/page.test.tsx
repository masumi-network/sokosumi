import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createTranslator, NextIntlClientProvider } from "next-intl";
import { NuqsTestingAdapter } from "nuqs/adapters/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFormats } from "@/i18n/time-format";
import german from "../../../../messages/de.json";
import messages from "../../../../messages/en.json";
import {
  SEO_TEST_AUDIT,
  SEO_TEST_PAGE,
  SEO_TEST_PROJECT,
  seoTestWorkspace,
} from "./components/seo-test-fixture";
import SeoPage from "./page";

const m = vi.hoisted(() => ({
  listAudits: vi.fn(),
  getWorkspace: vi.fn(),
  coworkers: vi.fn(),
  createAudit: vi.fn(),
  push: vi.fn(),
  locale: vi.fn<() => Promise<"en" | "de">>(),
  connection: vi.fn(async () => {}),
}));
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  connection: m.connection,
}));
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  useRouter: () => ({ push: m.push, refresh: vi.fn() }),
}));
vi.mock("next/headers", () => ({ cookies: async () => new Map() }));
vi.mock("next/cache", () => ({ cacheLife: () => undefined }));
vi.mock("next-intl/server", () => ({
  getLocale: m.locale,
  getTranslations: async () =>
    createTranslator({ locale: "en", messages, namespace: "App.Seo" }),
}));
vi.mock("@/lib/services/seo.service", () => ({
  seoService: { listAudits: m.listAudits, getWorkspace: m.getWorkspace },
}));
vi.mock("@/lib/services/coworker.service", () => ({
  coworkerService: { listCoworkers: m.coworkers },
}));
vi.mock("@/lib/actions/seo/create-audit", () => ({
  createSeoAuditAction: m.createAudit,
}));
vi.mock("@/lib/auth/auth.client", () => ({
  useSession: () => ({
    data: { session: { activeOrganizationId: "org" }, user: { id: "owner" } },
  }),
}));

const clients: QueryClient[] = [];
async function show(
  params: Record<string, string> = {},
  locale: "en" | "de" = "en",
) {
  m.locale.mockResolvedValue(locale);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  clients.push(client);
  const page = await SeoPage({ searchParams: Promise.resolve(params) });
  return render(
    <QueryClientProvider client={client}>
      <NextIntlClientProvider
        locale={locale}
        timeZone="UTC"
        formats={createFormats()}
        messages={locale === "en" ? messages : german}
      >
        <NuqsTestingAdapter
          searchParams={new URLSearchParams(params)}
          hasMemory
        >
          {page}
        </NuqsTestingAdapter>
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  m.listAudits.mockResolvedValue({
    audits: [],
    pagination: { nextCursor: null },
  });
  m.coworkers.mockResolvedValue([]);
  m.createAudit.mockResolvedValue({
    ok: true,
    value: {
      ...seoTestWorkspace(),
      projectId: null,
      auditId: SEO_TEST_AUDIT,
      auditName: "Launch pages",
    },
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({ projects: [], nextCursor: null })),
  );
});
afterEach(() => {
  clients.splice(0).forEach((client) => client.clear());
  vi.unstubAllGlobals();
});

describe("native SEO audit entry", () => {
  it("opens the audit index without a selected Project or assistant", async () => {
    await show();
    expect(screen.getByRole("button", { name: "Continue" })).toBeVisible();
    expect(
      screen.getByRole("heading", { name: "Start your first SEO audit" }),
    ).toBeVisible();
    const steps = within(
      screen.getByRole("list", { name: "Setup steps" }),
    ).getAllByRole("listitem");
    expect(steps.map((step) => step.getAttribute("aria-current"))).toEqual([
      "step",
    ]);
    expect(
      within(steps[0]).getByRole("form", { name: "Create audit" }),
    ).toBeVisible();
    expect(
      screen.queryByRole("button", { name: /Select project|Create project/ }),
    ).toBeNull();
    expect(
      screen.queryByText(
        /personal project manager|inbox and calendar|Soko Bot/i,
      ),
    ).toBeNull();
    expect(m.listAudits).toHaveBeenCalledWith({
      cursor: undefined,
      projectId: undefined,
    });
    expect(m.getWorkspace).not.toHaveBeenCalled();
    expect(m.coworkers).not.toHaveBeenCalled();
  });

  it("reads archived reports in the chosen project and keeps the cursor in the archive", async () => {
    m.listAudits.mockResolvedValue({
      audits: [],
      pagination: { nextCursor: SEO_TEST_AUDIT },
    });
    await show({
      view: "archived",
      projectId: SEO_TEST_PROJECT,
      cursor: SEO_TEST_PAGE,
    });
    expect(m.listAudits).toHaveBeenCalledWith({
      projectId: SEO_TEST_PROJECT,
      cursor: SEO_TEST_PAGE,
      status: "archived",
    });
    expect(
      screen.getByRole("link", { name: messages.App.Seo.more }),
    ).toHaveAttribute(
      "href",
      `/seo?projectId=${SEO_TEST_PROJECT}&view=archived&cursor=${SEO_TEST_AUDIT}`,
    );
    expect(m.getWorkspace).not.toHaveBeenCalled();
  });

  it("opens the form for a new Audit from the workspace switch prompt's link", async () => {
    m.listAudits.mockResolvedValue({
      audits: [
        {
          id: SEO_TEST_AUDIT,
          name: "Launch pages",
          projectId: null,
          pageCount: 1,
          createdAt: new Date("2026-01-02T12:00:00Z"),
        },
      ],
      pagination: { nextCursor: null },
    });
    await show({ add: "1" });
    expect(screen.getByRole("dialog", { name: "Create audit" })).toBeVisible();
  });

  it("creates an audit with its first page and navigates by auditId without a Project ID", async () => {
    const user = userEvent.setup();
    await show();
    const form = screen.getByRole("form", { name: "Create audit" });
    await user.type(within(form).getByLabelText("Audit name"), "Launch pages");
    await user.type(
      within(form).getByLabelText("First page URL"),
      "https://example.test/launch",
    );
    await user.click(within(form).getByRole("button", { name: "Continue" }));
    expect(m.createAudit).toHaveBeenCalledExactlyOnceWith({
      body: {
        name: "Launch pages",
        firstPage: { url: "https://example.test/launch" },
      },
    });
    expect(m.push).toHaveBeenCalledWith(`/seo?auditId=${SEO_TEST_AUDIT}`);
  });

  it("loads a German SEO workspace with English audit results and German tabs", async () => {
    const workspace = seoTestWorkspace();
    workspace.auditId = SEO_TEST_AUDIT;
    workspace.seasonalIdeas = [
      {
        keyword: "Pièces détachées",
        audience: "repair shops",
        country: "FR",
        language: "fr",
        url: workspace.pages[0].url,
        asOf: new Date("2026-11-01"),
        pageQuote: "Pièces détachées pour vélos",
        action: "investigate_angle",
        limitations: [],
        event: null,
        comparison: null,
        windows: [],
      },
    ];
    m.getWorkspace.mockResolvedValue(workspace);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(workspace)),
    );
    await show(
      { auditId: SEO_TEST_AUDIT, projectId: SEO_TEST_PROJECT, tab: "rankings" },
      "de",
    );
    expect(
      screen.getByRole("heading", { name: "Pièces détachées" }),
    ).toBeVisible();
    expect(
      screen.getByText("Check this search for repair shops."),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: german.App.Seo.keywords.ideas.short }),
    ).toBeVisible();
  });

  it("opens an existing Audit without consulting a generic Coworker catalog", async () => {
    const workspace = {
      ...seoTestWorkspace(),
      auditId: SEO_TEST_AUDIT,
      auditName: "Launch pages",
    };
    m.getWorkspace.mockResolvedValue(workspace);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(workspace)),
    );
    await show({ auditId: SEO_TEST_AUDIT, projectId: SEO_TEST_PROJECT });
    expect(screen.getByRole("heading", { name: "Launch pages" })).toBeVisible();
    expect(m.coworkers).not.toHaveBeenCalled();
  });

  it("loads a channel only on Traffic and drops a stale one from the URL", async () => {
    m.getWorkspace.mockResolvedValue({
      ...seoTestWorkspace(),
      auditId: SEO_TEST_AUDIT,
    });
    const open = { auditId: SEO_TEST_AUDIT, projectId: SEO_TEST_PROJECT };
    await expect(
      SeoPage({ searchParams: Promise.resolve({ ...open, channel: "all" }) }),
    ).rejects.toMatchObject({
      digest: expect.stringContaining(
        `/seo?auditId=${SEO_TEST_AUDIT}&projectId=${SEO_TEST_PROJECT};`,
      ),
    });
    expect(m.getWorkspace).not.toHaveBeenCalled();
    await SeoPage({
      searchParams: Promise.resolve({
        ...open,
        tab: "traffic",
        channel: "all",
      }),
    });
    expect(m.getWorkspace).toHaveBeenCalledWith(
      { kind: "audit", id: SEO_TEST_AUDIT },
      { channel: "all" },
    );
  });

  it("loads a search type only on Traffic and drops a stale one from the URL", async () => {
    m.getWorkspace.mockResolvedValue({
      ...seoTestWorkspace(),
      auditId: SEO_TEST_AUDIT,
    });
    const open = { auditId: SEO_TEST_AUDIT, projectId: SEO_TEST_PROJECT };
    await expect(
      SeoPage({
        searchParams: Promise.resolve({
          ...open,
          tab: "agent",
          searchType: "discover",
        }),
      }),
    ).rejects.toMatchObject({
      digest: expect.stringContaining(
        `/seo?auditId=${SEO_TEST_AUDIT}&projectId=${SEO_TEST_PROJECT}&tab=agent;`,
      ),
    });
    expect(m.getWorkspace).not.toHaveBeenCalled();
    await SeoPage({
      searchParams: Promise.resolve({
        ...open,
        tab: "traffic",
        searchType: "discover",
      }),
    });
    expect(m.getWorkspace).toHaveBeenCalledWith(
      { kind: "audit", id: SEO_TEST_AUDIT },
      { searchType: "discover" },
    );
  });

  it("opens an Audit in its own Project scope, so the header names that Project", async () => {
    m.getWorkspace.mockResolvedValue({
      ...seoTestWorkspace(),
      auditId: SEO_TEST_AUDIT,
    });
    await expect(
      SeoPage({ searchParams: Promise.resolve({ auditId: SEO_TEST_AUDIT }) }),
    ).rejects.toMatchObject({
      digest: expect.stringContaining(
        `/seo?projectId=${SEO_TEST_PROJECT}&auditId=${SEO_TEST_AUDIT};`,
      ),
    });
  });

  it("moves an open Audit to its own scope and keeps its tab and page filter", async () => {
    const other = "01951111-1111-7111-8111-999999999999";
    m.getWorkspace.mockResolvedValue({
      ...seoTestWorkspace(),
      auditId: SEO_TEST_AUDIT,
    });
    await expect(
      SeoPage({
        searchParams: Promise.resolve({
          projectId: other,
          auditId: SEO_TEST_AUDIT,
          tab: "rankings",
          pageId: SEO_TEST_PAGE,
        }),
      }),
    ).rejects.toMatchObject({
      digest: expect.stringContaining(
        `/seo?projectId=${SEO_TEST_PROJECT}&auditId=${SEO_TEST_AUDIT}&tab=rankings&pageId=${SEO_TEST_PAGE};`,
      ),
    });
    m.getWorkspace.mockResolvedValue({
      ...seoTestWorkspace(),
      auditId: SEO_TEST_AUDIT,
      projectId: null,
    });
    await expect(
      SeoPage({
        searchParams: Promise.resolve({
          projectId: SEO_TEST_PROJECT,
          auditId: SEO_TEST_AUDIT,
        }),
      }),
    ).rejects.toMatchObject({
      digest: expect.stringContaining(`/seo?auditId=${SEO_TEST_AUDIT};`),
    });
  });

  it("opens the Project's own SEO workspace, where its Soko Bot keeps pages, and links to it from the Project's Audits", async () => {
    m.getWorkspace.mockResolvedValue(seoTestWorkspace());
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(seoTestWorkspace())),
    );
    await show({ projectId: SEO_TEST_PROJECT, view: "project" });
    expect(m.getWorkspace).toHaveBeenCalledWith(
      { kind: "project", id: SEO_TEST_PROJECT },
      expect.anything(),
    );
    expect(m.listAudits).not.toHaveBeenCalled();
    cleanup();
    await show({ projectId: SEO_TEST_PROJECT });
    expect(
      screen.getByRole("link", { name: "Project SEO workspace" }),
    ).toHaveAttribute(
      "href",
      `/seo?projectId=${SEO_TEST_PROJECT}&view=project`,
    );
  });

  it("lists the scoped Project's Audits and links a new Audit to that Project", async () => {
    const user = userEvent.setup();
    await show({ projectId: SEO_TEST_PROJECT });
    expect(m.listAudits).toHaveBeenCalledWith({
      cursor: undefined,
      projectId: SEO_TEST_PROJECT,
    });
    expect(
      screen.getByRole("heading", {
        name: "Start this project's first SEO audit",
      }),
    ).toBeVisible();
    const form = screen.getByRole("form", { name: "Create audit" });
    await user.type(within(form).getByLabelText("Audit name"), "Launch pages");
    await user.type(
      within(form).getByLabelText("First page URL"),
      "https://example.test/launch",
    );
    await user.click(within(form).getByRole("button", { name: "Continue" }));
    expect(m.createAudit).toHaveBeenCalledExactlyOnceWith({
      body: {
        name: "Launch pages",
        firstPage: { url: "https://example.test/launch" },
        projectId: SEO_TEST_PROJECT,
      },
    });
    expect(m.push).toHaveBeenCalledWith(
      `/seo?projectId=${SEO_TEST_PROJECT}&auditId=${SEO_TEST_AUDIT}`,
    );
  });

  it("names an Audit after the page host when the name is left empty", async () => {
    const user = userEvent.setup();
    await show();
    const form = screen.getByRole("form", { name: "Create audit" });
    await user.type(
      within(form).getByLabelText("First page URL"),
      "https://www.example.test/launch",
    );
    await user.click(within(form).getByRole("button", { name: "Continue" }));
    expect(m.createAudit).toHaveBeenCalledExactlyOnceWith({
      body: {
        name: "example.test",
        firstPage: { url: "https://www.example.test/launch" },
      },
    });
  });

  it("keeps the inline form and entered pages when audit creation fails", async () => {
    m.createAudit.mockResolvedValue({
      ok: false,
      error: { code: "BAD_INPUT" },
    });
    const user = userEvent.setup();
    await show();
    const form = screen.getByRole("form", { name: "Create audit" });
    await user.type(within(form).getByLabelText("Audit name"), "Launch pages");
    await user.type(
      within(form).getByLabelText("First page URL"),
      "https://example.test/launch",
    );
    await user.click(within(form).getByRole("button", { name: "Continue" }));
    expect(await within(form).findByRole("alert")).toHaveTextContent(
      "Could not create the audit",
    );
    expect(within(form).getByLabelText("First page URL")).toHaveValue(
      "https://example.test/launch",
    );
    expect(m.push).not.toHaveBeenCalled();
  });
});

describe("SEO link prefetch", () => {
  // The Audit list read is cached, so a link prefetch carries it.
  it("reads the Audit list without deferring to the request", async () => {
    await SeoPage({ searchParams: Promise.resolve({}) });
    expect(m.connection).not.toHaveBeenCalled();
  });

  // A workspace read is not cached, so a link prefetch must stop before it.
  it.each([
    ["an Audit", { auditId: SEO_TEST_AUDIT }],
    ["a Project's", { projectId: SEO_TEST_PROJECT, view: "project" }],
  ])("keeps %s workspace out of the link prefetch", async (_, params) => {
    m.getWorkspace.mockResolvedValue(seoTestWorkspace());
    // A prefetch never resolves connection(), so the page must wait on it.
    m.connection.mockReturnValueOnce(new Promise<void>(() => {}));
    void SeoPage({ searchParams: Promise.resolve(params) });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(m.connection).toHaveBeenCalledOnce();
    expect(m.getWorkspace).not.toHaveBeenCalled();
  });
});
