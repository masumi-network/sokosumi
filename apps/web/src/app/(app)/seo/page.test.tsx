import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createTranslator, NextIntlClientProvider } from "next-intl";
import { NuqsTestingAdapter } from "nuqs/adapters/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFormats } from "@/i18n/time-format";
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
}));
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  connection: async () => {},
}));
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  useRouter: () => ({ push: m.push }),
}));
vi.mock("next-intl/server", () => ({
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
async function show(params: Record<string, string> = {}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  clients.push(client);
  const page = await SeoPage({ searchParams: Promise.resolve(params) });
  return render(
    <QueryClientProvider client={client}>
      <NextIntlClientProvider
        locale="en"
        timeZone="UTC"
        formats={createFormats()}
        messages={messages}
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
    expect(screen.getByRole("button", { name: "Create audit" })).toBeVisible();
    expect(
      screen.getByRole("heading", { name: "Start your first SEO audit" }),
    ).toBeVisible();
    const steps = within(
      screen.getByRole("list", { name: "Setup steps" }),
    ).getAllByRole("listitem");
    expect(steps.map((step) => step.getAttribute("aria-current"))).toEqual([
      "step",
      null,
      null,
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
    await user.click(
      within(form).getByRole("button", { name: "Create audit" }),
    );
    expect(m.createAudit).toHaveBeenCalledExactlyOnceWith({
      body: {
        name: "Launch pages",
        firstPage: { url: "https://example.test/launch" },
      },
    });
    expect(m.push).toHaveBeenCalledWith(`/seo?auditId=${SEO_TEST_AUDIT}`);
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
    await user.click(
      within(form).getByRole("button", { name: "Create audit" }),
    );
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
    await user.click(
      within(form).getByRole("button", { name: "Create audit" }),
    );
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
    await user.click(
      within(form).getByRole("button", { name: "Create audit" }),
    );
    expect(await within(form).findByRole("alert")).toHaveTextContent(
      "Could not create the audit",
    );
    expect(within(form).getByLabelText("First page URL")).toHaveValue(
      "https://example.test/launch",
    );
    expect(m.push).not.toHaveBeenCalled();
  });
});
