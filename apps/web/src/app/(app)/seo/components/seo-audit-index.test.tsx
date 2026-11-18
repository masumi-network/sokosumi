import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFormats } from "@/i18n/time-format";
import { createSeoAuditAction } from "@/lib/actions/seo/create-audit";
import { deleteSeoAuditAction } from "@/lib/actions/seo/delete-audit";
import messages from "../../../../../messages/en.json";
import { SeoAuditIndex } from "./seo-audit-index";

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("@/lib/actions/seo/create-audit", () => ({
  createSeoAuditAction: vi.fn(),
}));

vi.mock("@/lib/actions/seo/delete-audit", () => ({
  deleteSeoAuditAction: vi.fn(),
}));

const AUDIT = {
  canDelete: true,
  id: "0199c500-b109-7273-9a20-ceb2b79691fe",
  name: "Battery audit",
  projectId: null,
  pageCount: 1,
  createdAt: new Date("2026-01-02T12:00:00Z"),
};
type AuditRow = Omit<typeof AUDIT, "canDelete"> & { canDelete?: boolean };
function show(
  audits: AuditRow[],
  addOpen: boolean,
  options: { projectId?: string; cursor?: string; nextCursor?: string } = {},
) {
  render(
    <NextIntlClientProvider
      locale="en"
      timeZone="UTC"
      messages={messages}
      formats={createFormats()}
    >
      <SeoAuditIndex
        audits={audits as never}
        cursor={options.cursor ?? null}
        nextCursor={options.nextCursor ?? null}
        projectId={options.projectId ?? null}
        addOpen={addOpen}
      />
    </NextIntlClientProvider>,
  );
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

  it("offers deletion only on permitted audits and returns keyboard focus on cancel", async () => {
    const user = userEvent.setup();
    const readonly = {
      ...AUDIT,
      id: "other",
      name: "Shared audit",
      canDelete: false,
    };
    show(
      [
        AUDIT,
        readonly,
        { ...readonly, id: "older", name: "Older audit", canDelete: undefined },
      ],
      false,
    );
    expect(
      screen.getAllByRole("button", { name: /More options/ }),
    ).toHaveLength(1);
    const menu = screen.getByRole("button", {
      name: "More options for Battery audit",
    });
    expect(menu.closest("a")).toBeNull();
    menu.focus();
    await user.keyboard("{ArrowDown}");
    const item = await screen.findByRole("menuitem", { name: "Delete audit" });
    await waitFor(() => expect(item).toHaveFocus());
    await user.keyboard("{Enter}");
    const dialog = await screen.findByRole("alertdialog", {
      name: /Battery audit/,
    });
    await waitFor(() =>
      expect(
        within(dialog).getByRole("button", { name: "Cancel" }),
      ).toHaveFocus(),
    );
    await user.keyboard("{Escape}");
    await waitFor(() => expect(menu).toHaveFocus());
    expect(deleteSeoAuditAction).not.toHaveBeenCalled();
    expect(router.push).not.toHaveBeenCalled();
  });

  it("retains the row until deletion succeeds and leaves a refused delete open for retry", async () => {
    const user = userEvent.setup();
    const next = { ...AUDIT, id: "another", name: "Monthly report" };
    const request =
      Promise.withResolvers<Awaited<ReturnType<typeof deleteSeoAuditAction>>>();
    vi.mocked(deleteSeoAuditAction)
      .mockReturnValueOnce(request.promise)
      .mockResolvedValueOnce({ ok: true, value: null });
    show([AUDIT, next], false);
    await user.click(
      screen.getByRole("button", { name: "More options for Battery audit" }),
    );
    await user.click(
      await screen.findByRole("menuitem", { name: "Delete audit" }),
    );
    const dialog = await screen.findByRole("alertdialog");
    const confirm = within(dialog).getByRole("button", {
      name: "Delete audit",
    });
    await user.dblClick(confirm);
    expect(deleteSeoAuditAction).toHaveBeenCalledExactlyOnceWith({
      auditId: AUDIT.id,
    });
    expect(
      screen.getByRole("link", { name: /Battery audit/, hidden: true }),
    ).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(dialog).toBeInTheDocument();
    await act(async () =>
      request.resolve({
        ok: false,
        error: {
          code: "CONFLICT",
          status: 409,
          kind: "seo_audit_resumable_monitor",
        },
      }),
    );
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      messages.App.Seo.audits.deleteScheduled,
    );
    await user.click(confirm);
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(screen.queryByRole("link", { name: /Battery audit/ })).toBeNull();
    expect(screen.getByRole("link", { name: /Monthly report/ })).toHaveFocus();
  });

  it("lets the user cancel when delete access changes during confirmation", async () => {
    vi.mocked(deleteSeoAuditAction).mockResolvedValueOnce({
      ok: false,
      error: { code: "FORBIDDEN", status: 403 },
    });
    const user = userEvent.setup();
    show([AUDIT], false);
    await user.click(
      screen.getByRole("button", { name: "More options for Battery audit" }),
    );
    await user.click(
      await screen.findByRole("menuitem", { name: "Delete audit" }),
    );
    const dialog = within(await screen.findByRole("alertdialog"));
    await user.click(dialog.getByRole("button", { name: "Delete audit" }));
    expect(await dialog.findByRole("alert")).toHaveTextContent(
      messages.App.Seo.audits.deleteUnavailable,
    );
    expect(dialog.getByRole("button", { name: "Delete audit" })).toBeDisabled();
    await user.click(dialog.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("link", { name: /Battery audit/ })).toBeVisible();
    expect(deleteSeoAuditAction).toHaveBeenCalledTimes(1);
  });

  it.each([undefined, "previous"])(
    "keeps the project and the server cursor when the visible rows are removed (cursor %s)",
    async (cursor) => {
      const projectId = "project-id";
      const first = { ...AUDIT, id: "first", name: "First audit" };
      const user = userEvent.setup();
      vi.mocked(deleteSeoAuditAction).mockResolvedValue({
        ok: true,
        value: null,
      });
      show([first, AUDIT], false, {
        projectId,
        cursor,
        nextCursor: AUDIT.id,
      });
      await user.click(
        screen.getByRole("button", { name: "More options for Battery audit" }),
      );
      await user.click(
        await screen.findByRole("menuitem", { name: "Delete audit" }),
      );
      await user.click(
        within(await screen.findByRole("alertdialog")).getByRole("button", {
          name: "Delete audit",
        }),
      );
      const more = await screen.findByRole("link", {
        name: messages.App.Seo.more,
      });
      await waitFor(() =>
        expect(more).toHaveAttribute(
          "href",
          `/seo?projectId=project-id&cursor=${AUDIT.id}`,
        ),
      );
      await user.click(
        screen.getByRole("button", { name: "More options for First audit" }),
      );
      await user.click(
        await screen.findByRole("menuitem", { name: "Delete audit" }),
      );
      await user.click(
        within(await screen.findByRole("alertdialog")).getByRole("button", {
          name: "Delete audit",
        }),
      );
      await waitFor(() => expect(more).toHaveFocus());
      expect(more).toHaveAttribute(
        "href",
        `/seo?projectId=project-id&cursor=${AUDIT.id}`,
      );
      expect(
        screen.getByRole("heading", { name: messages.App.Seo.audits.saved }),
      ).toBeVisible();
      expect(router.replace).not.toHaveBeenCalled();
      expect(screen.queryByRole("textbox", { name: /URL/ })).toBeNull();
    },
  );

  it.each([undefined, "previous"])(
    "recovers after removing the last audit without a next page (cursor %s)",
    async (cursor) => {
      const user = userEvent.setup();
      vi.mocked(deleteSeoAuditAction).mockResolvedValue({
        ok: true,
        value: null,
      });
      show([AUDIT], false, { cursor, projectId: "project-id" });
      await user.click(
        screen.getByRole("button", { name: "More options for Battery audit" }),
      );
      await user.click(
        await screen.findByRole("menuitem", { name: "Delete audit" }),
      );
      await user.click(
        within(await screen.findByRole("alertdialog")).getByRole("button", {
          name: "Delete audit",
        }),
      );
      if (cursor) {
        await waitFor(() =>
          expect(router.replace).toHaveBeenCalledExactlyOnceWith(
            "/seo?projectId=project-id",
          ),
        );
        expect(
          await screen.findByRole("link", {
            name: messages.App.Seo.audits.all,
          }),
        ).toHaveAttribute("href", "/seo?projectId=project-id");
        expect(screen.queryByRole("textbox", { name: /URL/ })).toBeNull();
      } else {
        await waitFor(() =>
          expect(screen.getByRole("textbox", { name: /URL/ })).toHaveFocus(),
        );
        expect(router.replace).not.toHaveBeenCalled();
      }
    },
  );

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
