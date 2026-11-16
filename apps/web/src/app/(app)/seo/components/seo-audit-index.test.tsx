import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSeoAuditAction } from "@/lib/actions/seo/create-audit";
import messages from "../../../../../messages/en.json";
import { SeoAuditIndex } from "./seo-audit-index";

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("@/lib/actions/seo/create-audit", () => ({
  createSeoAuditAction: vi.fn(),
}));

const AUDIT = {
  id: "0199c500-b109-7273-9a20-ceb2b79691fe",
  name: "Battery audit",
  projectId: null,
  pageCount: 1,
  createdAt: new Date("2026-01-02T12:00:00Z"),
};
function show(audits: (typeof AUDIT)[], addOpen: boolean) {
  render(
    <NextIntlClientProvider locale="en" timeZone="UTC" messages={messages}>
      <SeoAuditIndex
        audits={audits as never}
        nextCursor={null}
        projectId={null}
        addOpen={addOpen}
      />
    </NextIntlClientProvider>,
  );
}

describe("SEO audit list", () => {
  beforeEach(() => vi.clearAllMocks());

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
