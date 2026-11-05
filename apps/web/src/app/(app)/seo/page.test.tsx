import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createTranslator, NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFormats } from "@/i18n/time-format";
import messages from "../../../../messages/en.json";
import {
  SEO_TEST_AUDIT,
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
        {page}
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
    expect(screen.getByText("No audits yet")).toBeVisible();
    expect(
      screen.queryByRole("button", { name: /Select project|Create project/ }),
    ).toBeNull();
    expect(
      screen.queryByText(
        /personal project manager|inbox and calendar|Soko Bot/i,
      ),
    ).toBeNull();
    expect(m.listAudits).toHaveBeenCalledWith({ cursor: undefined });
    expect(m.getWorkspace).not.toHaveBeenCalled();
    expect(m.coworkers).not.toHaveBeenCalled();
  });

  it("creates an audit with its first page and navigates by auditId without a Project ID", async () => {
    const user = userEvent.setup();
    await show();
    await user.click(screen.getByRole("button", { name: "Create audit" }));
    const form = screen.getByRole("dialog", { name: "Create audit" });
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

  it("keeps the dialog and entered pages when audit creation fails", async () => {
    m.createAudit.mockResolvedValue({
      ok: false,
      error: { code: "BAD_INPUT" },
    });
    const user = userEvent.setup();
    await show();
    await user.click(screen.getByRole("button", { name: "Create audit" }));
    const form = screen.getByRole("dialog", { name: "Create audit" });
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
