import type { SeoAuditSummary } from "@sokosumi/core-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFormats } from "@/i18n/time-format";
import { createSeoAuditAction } from "@/lib/actions/seo/create-audit";
import { setSeoAuditArchivedAction } from "@/lib/actions/seo/set-audit-archived";
import { getQueryClient } from "@/queries/get-query-client";
import messages from "../../../../../messages/en.json";
import { SeoAuditIndex } from "./seo-audit-index";
import { SEO_AUDIT_LIST_REFRESH_MS } from "./seo-audit-status";

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  useRouter: () => router,
}));
vi.mock("@/lib/actions/seo/set-audit-archived", () => ({
  setSeoAuditArchivedAction: vi.fn(),
}));
vi.mock("@/lib/actions/seo/create-audit", () => ({
  createSeoAuditAction: vi.fn(),
}));
vi.mock("@/lib/auth/auth.client", () => ({
  useSession: () => ({
    data: {
      session: { activeOrganizationId: null },
      user: { id: "owner" },
    },
  }),
}));

const AUDIT: SeoAuditSummary = {
  id: "0199c500-b109-7273-9a20-ceb2b79691fe",
  name: "Battery audit",
  projectId: null,
  pageCount: 1,
  lastCheck: null,
  createdAt: new Date("2026-01-02T12:00:00Z"),
  updatedAt: new Date("2026-01-02T12:00:00Z"),
};
function show(
  audits: SeoAuditSummary[],
  addOpen: boolean,
  options: {
    projectId?: string;
    cursor?: string;
    nextCursor?: string;
    archived?: boolean;
    searching?: boolean;
    client?: QueryClient;
  } = {},
) {
  const client =
    options.client ??
    new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
  const tree = (list: SeoAuditSummary[]) => (
    <QueryClientProvider client={client}>
      <NextIntlClientProvider
        locale="en"
        timeZone="UTC"
        messages={messages}
        formats={createFormats()}
      >
        <SeoAuditIndex
          audits={list}
          archived={options.archived}
          searching={options.searching}
          cursor={options.cursor ?? null}
          nextCursor={options.nextCursor ?? null}
          projectId={options.projectId ?? null}
          addOpen={addOpen}
        />
      </NextIntlClientProvider>
    </QueryClientProvider>
  );
  return render(tree(audits));
}

describe("SEO audit list", () => {
  beforeEach(() => vi.clearAllMocks());

  it("uses the only list heading to name the region containing the saved audits", () => {
    show([AUDIT], false);
    expect(screen.getAllByRole("heading", { level: 2 })).toHaveLength(1);
    const list = screen.getByRole("region", {
      name: messages.App.Seo.audits.saved,
    });
    expect(
      within(list).getByRole("link", { name: /Battery audit/ }),
    ).toBeVisible();
  });

  it("links to each report without offering a row menu", () => {
    const shared = {
      ...AUDIT,
      id: "shared",
      name: "Shared audit",
      projectId: "project-id",
    };
    show([AUDIT, shared], false);
    const rows = within(screen.getByRole("list"));
    expect(rows.getByRole("link", { name: /Battery audit/ })).toHaveAttribute(
      "href",
      `/seo?auditId=${AUDIT.id}`,
    );
    expect(rows.getByRole("link", { name: /Shared audit/ })).toHaveAttribute(
      "href",
      "/seo?projectId=project-id&auditId=shared",
    );
    expect(rows.queryByRole("button")).toBeNull();
  });

  it("says in each row whether the audit's newest check runs, failed or when it finished", () => {
    const at = new Date();
    const check = (status: "running" | "failed" | "completed") => ({
      kind: "page_check" as const,
      status,
      createdAt: at,
      updatedAt: at,
    });
    show(
      [
        {
          ...AUDIT,
          id: "running",
          name: "Running",
          lastCheck: check("running"),
        },
        { ...AUDIT, id: "failed", name: "Failed", lastCheck: check("failed") },
        { ...AUDIT, id: "done", name: "Done", lastCheck: check("completed") },
      ],
      false,
    );
    const row = (name: string) =>
      within(screen.getByRole("link", { name: new RegExp(name) }));
    expect(
      row("Running").getByText(messages.App.Seo.setup.checkRunningBadge),
    ).toBeVisible();
    expect(
      row("Failed").getByText(messages.App.Seo.audits.checkFailed),
    ).toBeVisible();
    expect(row("Done").getByText(/Last check: Page check/)).toBeVisible();
    expect(
      row("Done").queryByText(messages.App.Seo.setup.checkRunningBadge),
    ).toBeNull();
  });

  it("reads the list again while a check runs and shows the finished check without a reload", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const at = new Date();
      const check = (status: "running" | "completed") => ({
        kind: "page_check" as const,
        status,
        createdAt: at,
        updatedAt: at,
      });
      const fetchMock = vi.fn(async (_url: string) =>
        Response.json({
          audits: [{ ...AUDIT, lastCheck: check("completed") }],
          pagination: null,
        }),
      );
      vi.stubGlobal("fetch", fetchMock);
      show([{ ...AUDIT, lastCheck: check("running") }], false, {
        projectId: "6a3f5c1e-0d62-4f0e-8d4e-6d6f1a9c2b11",
      });
      expect(
        screen.getByText(messages.App.Seo.setup.checkRunningBadge),
      ).toBeVisible();
      expect(fetchMock).not.toHaveBeenCalled();
      await act(() => vi.advanceTimersByTimeAsync(SEO_AUDIT_LIST_REFRESH_MS));
      await waitFor(() =>
        expect(screen.getByText(/Last check: Page check/)).toBeVisible(),
      );
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock.mock.calls[0]?.[0]).toBe(
        "/api/seo/audits?projectId=6a3f5c1e-0d62-4f0e-8d4e-6d6f1a9c2b11",
      );
      await act(() =>
        vi.advanceTimersByTimeAsync(SEO_AUDIT_LIST_REFRESH_MS * 2),
      );
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
      vi.unstubAllGlobals();
    }
  });

  describe("while a check runs", () => {
    const at = new Date();
    const check = (status: "running" | "completed") => ({
      kind: "page_check" as const,
      status,
      createdAt: at,
      updatedAt: at,
    });
    const tick = () =>
      act(() => vi.advanceTimersByTimeAsync(SEO_AUDIT_LIST_REFRESH_MS));
    beforeEach(() => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      return () => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
      };
    });

    it("reads again after a failed read and shows the finished check", async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(new Response(null, { status: 503 }))
        .mockResolvedValue(
          Response.json({
            audits: [{ ...AUDIT, lastCheck: check("completed") }],
            pagination: null,
          }),
        );
      vi.stubGlobal("fetch", fetchMock);
      show([{ ...AUDIT, lastCheck: check("running") }], false);
      await tick();
      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
      await tick();
      await waitFor(() =>
        expect(screen.getByText(/Last check: Page check/)).toBeVisible(),
      );
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("stops reading when the viewer may no longer read the list", async () => {
      const fetchMock = vi.fn(async () => new Response(null, { status: 401 }));
      vi.stubGlobal("fetch", fetchMock);
      show([{ ...AUDIT, lastCheck: check("running") }], false);
      await tick();
      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
      await act(() =>
        vi.advanceTimersByTimeAsync(SEO_AUDIT_LIST_REFRESH_MS * 3),
      );
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("takes the next-page cursor from the same read as the rows", async () => {
      const added = { ...AUDIT, id: "added", name: "Added audit" };
      vi.stubGlobal(
        "fetch",
        vi.fn(async () =>
          Response.json({
            audits: [added, { ...AUDIT, lastCheck: check("completed") }],
            pagination: { nextCursor: "after-added" },
          }),
        ),
      );
      show([{ ...AUDIT, lastCheck: check("running") }], false, {
        nextCursor: "after-battery",
      });
      await tick();
      await waitFor(() => expect(screen.getByText(added.name)).toBeVisible());
      expect(
        screen.getByRole("link", { name: messages.App.Seo.more }),
      ).toHaveAttribute("href", "/seo?cursor=after-added");
    });

    it("refreshes the rows of a search in the search's order", async () => {
      const other = { ...AUDIT, id: "other", name: "Battery other" };
      const fetchMock = vi.fn(async (url: string) =>
        Response.json(
          url.includes("cursor=")
            ? { audits: [other], pagination: null }
            : {
                audits: [{ ...AUDIT, lastCheck: check("completed") }],
                pagination: { nextCursor: "page-2" },
              },
        ),
      );
      vi.stubGlobal("fetch", fetchMock);
      show([other, { ...AUDIT, lastCheck: check("running") }], false, {
        searching: true,
      });
      await tick();
      await waitFor(() =>
        expect(screen.getByText(/Last check: Page check/)).toBeVisible(),
      );
      const names = within(
        screen.getByRole("region", { name: messages.App.Seo.audits.saved }),
      )
        .getAllByRole("link")
        .map((link) => link.textContent);
      expect(names[0]).toContain(other.name);
      expect(names[1]).toContain(AUDIT.name);
      // Pages of Core's largest size: 1,000 active audits take 10 reads per poll.
      expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
        "/api/seo/audits?limit=100",
        "/api/seo/audits?cursor=page-2&limit=100",
      ]);
    });

    it("drops a search row that a successful read no longer returns", async () => {
      const archived = { ...AUDIT, id: "archived", name: "Battery archived" };
      vi.stubGlobal(
        "fetch",
        vi.fn(async () =>
          Response.json({
            audits: [{ ...AUDIT, lastCheck: check("completed") }],
            pagination: null,
          }),
        ),
      );
      show([{ ...archived, lastCheck: check("running") }, AUDIT], false, {
        searching: true,
      });
      expect(screen.getByText(archived.name)).toBeVisible();
      await tick();
      await waitFor(() =>
        expect(screen.queryByText(archived.name)).not.toBeInTheDocument(),
      );
      expect(screen.getByText(AUDIT.name)).toBeVisible();
    });

    // The app's own client: its retry setting is the one a viewer gets.
    describe("with the production query client", () => {
      const client = getQueryClient();
      beforeEach(() => () => client.clear());

      it.each([404, 403])(
        "sends a read that failed with %i only once",
        async (status) => {
          const fetchMock = vi.fn(async () => new Response(null, { status }));
          vi.stubGlobal("fetch", fetchMock);
          show([{ ...AUDIT, lastCheck: check("running") }], false, { client });
          await tick();
          await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
          await act(() =>
            vi.advanceTimersByTimeAsync(SEO_AUDIT_LIST_REFRESH_MS * 3),
          );
          expect(fetchMock).toHaveBeenCalledTimes(1);
        },
      );

      it.each([503, 429])(
        "reads again after a read that failed with %i",
        async (status) => {
          const fetchMock = vi
            .fn()
            .mockResolvedValueOnce(new Response(null, { status }))
            .mockResolvedValue(
              Response.json({
                audits: [{ ...AUDIT, lastCheck: check("completed") }],
                pagination: null,
              }),
            );
          vi.stubGlobal("fetch", fetchMock);
          show([{ ...AUDIT, lastCheck: check("running") }], false, { client });
          await tick();
          await act(() =>
            vi.advanceTimersByTimeAsync(SEO_AUDIT_LIST_REFRESH_MS),
          );
          await waitFor(() =>
            expect(screen.getByText(/Last check: Page check/)).toBeVisible(),
          );
          expect(fetchMock).toHaveBeenCalledTimes(2);
        },
      );
    });
  });

  it.each([{ audits: [] }, { audits: [AUDIT] }])(
    "opens the archive in the current project from the header, including during onboarding",
    async ({ audits }) => {
      const user = userEvent.setup();
      show(audits, false, { projectId: "chosen-project" });
      const trigger = screen.getByRole("button", {
        name: messages.App.Seo.audits.listOptions,
      });
      trigger.focus();
      await user.keyboard("{ArrowDown}");
      const archivedLink = await screen.findByRole("menuitem", {
        name: messages.App.Seo.audits.showArchived,
      });
      expect(archivedLink).toHaveAttribute(
        "href",
        "/seo?projectId=chosen-project&view=archived",
      );
    },
  );

  it("returns from an empty archive to active reports without a stale cursor or creation dialog", async () => {
    const user = userEvent.setup();
    show([], true, { archived: true, projectId: "chosen-project" });
    expect(
      screen.getByText(messages.App.Seo.audits.archivedEmpty),
    ).toBeVisible();
    expect(screen.queryByRole("form")).toBeNull();
    await user.click(
      screen.getByRole("button", { name: messages.App.Seo.audits.listOptions }),
    );
    expect(
      await screen.findByRole("menuitem", {
        name: messages.App.Seo.audits.showActive,
      }),
    ).toHaveAttribute("href", "/seo?projectId=chosen-project");
  });

  it("restores only the selected report and allows retry if the request fails", async () => {
    const user = userEvent.setup();
    const request =
      Promise.withResolvers<
        Awaited<ReturnType<typeof setSeoAuditArchivedAction>>
      >();
    vi.mocked(setSeoAuditArchivedAction).mockReturnValueOnce(request.promise);
    const scoped = { ...AUDIT, projectId: "report-project" };
    const other = { ...AUDIT, id: "other", name: "Other report" };
    show([scoped, other], false, { archived: true });
    const rows = within(
      screen.getByRole("region", { name: messages.App.Seo.audits.archived }),
    );
    expect(rows.queryByRole("link")).toBeNull();
    const restore = rows.getByRole("button", {
      name: /Restore.*Battery audit/i,
    });
    await user.dblClick(restore);
    expect(setSeoAuditArchivedAction).toHaveBeenCalledExactlyOnceWith({
      auditId: AUDIT.id,
      projectId: scoped.projectId,
      archived: false,
    });
    expect(
      rows.getByRole("button", { name: /Restore.*Other report/i }),
    ).toBeDisabled();
    await act(async () =>
      request.resolve({ ok: false, error: { code: "FORBIDDEN", status: 403 } }),
    );
    expect(await rows.findByRole("alert")).toHaveTextContent(
      messages.App.Seo.audits.restoreFailed,
    );
    expect(restore).toBeEnabled();
    vi.mocked(setSeoAuditArchivedAction).mockResolvedValueOnce({
      ok: false,
      error: {
        code: "CONFLICT",
        status: 409,
        kind: "seo_audit_task_scope_conflict",
      },
    });
    await user.click(restore);
    expect(await rows.findByRole("alert")).toHaveTextContent(
      messages.App.Seo.audits.restoreTaskScopeConflict,
    );
  });

  it("keeps the project scope when following the next page", () => {
    show([AUDIT], false, { projectId: "project-id", nextCursor: AUDIT.id });
    expect(
      screen.getByRole("link", { name: messages.App.Seo.more }),
    ).toHaveAttribute("href", `/seo?projectId=project-id&cursor=${AUDIT.id}`);
  });

  it("returns to the project's audit list from an empty later page", () => {
    show([], false, { projectId: "project-id", cursor: AUDIT.id });
    expect(
      screen.getByRole("link", { name: messages.App.Seo.audits.all }),
    ).toHaveAttribute("href", "/seo?projectId=project-id");
    expect(screen.queryByRole("textbox", { name: /URL/ })).toBeNull();
  });

  it("starts with only the website form and Continue, before Google or the audit step", () => {
    show([], false);
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Continue" })).toBeVisible();
    expect(
      screen.queryByText(messages.App.Seo.audits.onboarding.connectTitle),
    ).toBeNull();
    expect(
      screen.queryByText(messages.App.Seo.audits.onboarding.checkTitle),
    ).toBeNull();
  });

  it("opens the form for a new Audit when the link asks for it, one time", async () => {
    show([AUDIT], true);
    expect(screen.getByRole("dialog", { name: "Create audit" })).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    // A reload must not open the form again.
    expect(router.replace).toHaveBeenCalledExactlyOnceWith("/seo");
  });

  it("leaves the address to the new Audit after a create from the link", async () => {
    vi.mocked(createSeoAuditAction).mockResolvedValue({
      ok: true,
      value: { auditId: AUDIT.id },
    } as never);
    show([AUDIT], true);
    await userEvent.type(
      screen.getByRole("textbox", { name: /URL/ }),
      "https://example.com/",
    );
    await userEvent.click(screen.getByRole("button", { name: "Create audit" }));
    await waitFor(() =>
      expect(router.push).toHaveBeenCalledExactlyOnceWith(
        `/seo?auditId=${AUDIT.id}`,
      ),
    );
    // A jump back to the list would hide the Audit the user just made.
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("retries a failed create with the same key, and uses a new key for other input", async () => {
    vi.mocked(createSeoAuditAction)
      .mockResolvedValueOnce({ ok: false } as never)
      .mockResolvedValueOnce({ ok: false } as never)
      .mockResolvedValueOnce({ ok: false } as never);
    show([], false);
    const url = screen.getByRole("textbox", { name: /URL/ });
    await userEvent.type(url, "example.com");
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(createSeoAuditAction).toHaveBeenCalledTimes(1));
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(createSeoAuditAction).toHaveBeenCalledTimes(2));
    await userEvent.clear(url);
    await userEvent.type(url, "example.org");
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(createSeoAuditAction).toHaveBeenCalledTimes(3));
    const keys = vi
      .mocked(createSeoAuditAction)
      .mock.calls.map(([request]) => request.body.idempotencyKey);
    expect(keys[0]).toBeTruthy();
    expect(keys[1]).toBe(keys[0]);
    expect(keys[2]).not.toBe(keys[0]);
  });

  it("takes a website typed without https://", async () => {
    vi.mocked(createSeoAuditAction).mockResolvedValue({
      ok: true,
      value: { auditId: AUDIT.id },
    } as never);
    show([], false);
    await userEvent.type(
      screen.getByRole("textbox", { name: /URL/ }),
      "example.com",
    );
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));
    await waitFor(() =>
      expect(createSeoAuditAction).toHaveBeenCalledExactlyOnceWith({
        body: expect.objectContaining({
          firstPage: { url: "https://example.com/" },
        }),
      }),
    );
  });

  it("keeps the form closed on a plain link, and the address when the user closes it", async () => {
    show([AUDIT], false);
    expect(screen.queryByRole("dialog")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Create audit" }));
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    // A list page with a cursor must not jump to the first page on a cancel.
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("shows one form on an empty list, not a dialog over the form in the page", () => {
    show([], true);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getAllByRole("form", { name: "Create audit" })).toHaveLength(
      1,
    );
  });
});
