import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFormats } from "@/i18n/time-format";
import messages from "../../../../../messages/en.json";
import type { SeoExport } from "./seo-export-model";
import { SeoTableButton } from "./seo-table-button";

const m = vi.hoisted(() => ({
  create: vi.fn(),
  batch: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  push: vi.fn(),
}));
vi.mock("@/lib/services/data-table.client", () => ({
  dataTableService: { create: m.create, batch: m.batch },
}));
vi.mock("sonner", () => ({ toast: { success: m.success, error: m.error } }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: m.push }) }));

const table = () => ({
  header: ["Keyword", "Searches a month"],
  rows: Array.from({ length: 150 }, (_, i) => [`keyword ${i}`, i ? i : null]),
});

function show(site = "example.com", rows: () => SeoExport = table) {
  render(
    <NextIntlClientProvider
      locale="en"
      messages={messages}
      timeZone="UTC"
      formats={createFormats()}
    >
      <SeoTableButton
        title="Keywords"
        site={site}
        projectId={null}
        table={rows}
      />
    </NextIntlClientProvider>,
  );
  return screen.getByRole("button", { name: "Copy to a table: Keywords" });
}

describe("SeoTableButton", () => {
  beforeEach(() => {
    m.create.mockResolvedValue({ id: "table-1" });
    m.batch.mockResolvedValue({});
  });

  it("creates one Table with every row and offers to open it", async () => {
    const user = userEvent.setup();
    await user.click(show());
    await waitFor(() => expect(m.success).toHaveBeenCalledOnce());
    const [body] = m.create.mock.calls[0];
    expect(body.title).toMatch(/^Keywords · example\.com · /);
    expect(body.description).toMatch(/^Copied from SEO on /);
    expect(
      m.batch.mock.calls.map(([id, batch]) => [id, batch.insert.length]),
    ).toEqual([
      ["table-1", 100],
      ["table-1", 50],
    ]);
    const [message, options] = m.success.mock.calls[0];
    expect(message).toBe("150 keywords copied to a new table.");
    // It carries the only way to the new Table: it stays until dismissed.
    expect(options).toMatchObject({ duration: Infinity, closeButton: true });
    options.action.onClick();
    expect(m.push).toHaveBeenCalledWith("/drive/tables/table-1");
  });

  it("finishes a failed copy on the next press without a second Table or row", async () => {
    m.batch.mockResolvedValueOnce({}).mockRejectedValueOnce(new Error("down"));
    const user = userEvent.setup();
    const button = show();
    await user.click(button);
    await waitFor(() => expect(m.error).toHaveBeenCalledOnce());
    expect(m.error.mock.calls[0][1]).toMatchObject({
      duration: Infinity,
      closeButton: true,
    });
    expect(m.success).not.toHaveBeenCalled();
    await waitFor(() => expect(button).toBeEnabled());
    await user.click(button);
    await waitFor(() => expect(m.success).toHaveBeenCalledOnce());
    expect(m.create).toHaveBeenCalledOnce();
    const keys = m.batch.mock.calls.map(([, batch]) => batch.key);
    // The failed batch goes again under its own key; the first is not sent twice.
    expect(keys).toHaveLength(3);
    expect(keys[2]).toBe(keys[1]);
    expect(keys[0]).not.toBe(keys[1]);
  });

  it("shortens a long project name so the Table title fits, and keeps the date", async () => {
    // A project name may hold 200 characters; a Table title 160.
    const user = userEvent.setup();
    await user.click(show("p".repeat(200)));
    await waitFor(() => expect(m.success).toHaveBeenCalledOnce());
    const [body] = m.create.mock.calls[0];
    expect(body.title).toHaveLength(160);
    expect(body.title).toMatch(/^Keywords · p+… · \w{3} \d{1,2}, \d{4}$/);
  });

  it("reports a copy it cannot plan and frees the button", async () => {
    const user = userEvent.setup();
    const button = show("example.com", () => {
      throw new Error("bad table");
    });
    await user.click(button);
    await waitFor(() => expect(m.error).toHaveBeenCalledOnce());
    expect(m.create).not.toHaveBeenCalled();
    await waitFor(() => expect(button).not.toHaveAttribute("aria-busy"));
  });
});
