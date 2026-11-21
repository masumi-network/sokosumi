import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFormats } from "@/i18n/time-format";
import { SeoResultMessagesProvider } from "@/i18n/use-seo-result-translations";
import german from "../../../../../messages/de.json";
import messages from "../../../../../messages/en.json";
import { SeoExportMenu } from "./seo-export-menu";
import { type SeoExport, seoQueriesExport } from "./seo-export-model";

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

function menu(empty = false, rows: () => SeoExport = table) {
  return (
    <NextIntlClientProvider
      locale="en"
      messages={messages}
      timeZone="UTC"
      formats={createFormats()}
    >
      <SeoExportMenu
        name="keywords"
        titleKey="keywords.title"
        workspace={{
          auditName: "example.com",
          websiteUrl: null,
          projectId: null,
        }}
        table={rows}
        empty={empty}
      />
    </NextIntlClientProvider>
  );
}

function show(site = "example.com", rows: () => SeoExport = table) {
  render(
    <NextIntlClientProvider
      locale="en"
      messages={messages}
      timeZone="UTC"
      formats={createFormats()}
    >
      <SeoExportMenu
        name="keywords"
        titleKey="keywords.title"
        workspace={{ auditName: site, websiteUrl: null, projectId: null }}
        table={rows}
      />
    </NextIntlClientProvider>,
  );
  return screen.getByRole("button", { name: "Export: Keywords" });
}

/** Opens the menu and picks one of its items. */
async function pick(
  user: ReturnType<typeof userEvent.setup>,
  trigger: HTMLElement,
  item: string,
) {
  await user.click(trigger);
  await user.click(await screen.findByRole("menuitem", { name: item }));
}

describe("SeoExportMenu", () => {
  beforeEach(() => {
    m.create.mockResolvedValue({ id: "table-1" });
    m.batch.mockResolvedValue({});
  });

  it("creates one Table with every row and offers to open it", async () => {
    const user = userEvent.setup();
    await pick(user, show(), "Copy to a table");
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
    expect(message).toBe("150 rows copied to a new table.");
    // It carries the only way to the new Table: it stays until dismissed.
    expect(options).toMatchObject({ duration: Infinity, closeButton: true });
    options.action.onClick();
    expect(m.push).toHaveBeenCalledWith("/drive/tables/table-1");
  });

  it("exports English column names and the original search query from a German menu", async () => {
    const user = userEvent.setup();
    const query = "Wärmepumpe Förderung";
    render(
      <NextIntlClientProvider
        locale="de"
        messages={german}
        formats={createFormats()}
        timeZone="Europe/Berlin"
      >
        <SeoResultMessagesProvider messages={messages.App.Seo}>
          <SeoExportMenu
            name="search-queries"
            titleKey="queries.title"
            workspace={{
              auditName: "example.com",
              websiteUrl: null,
              projectId: null,
            }}
            table={(report) =>
              seoQueriesExport(
                [
                  {
                    id: "query-1",
                    query,
                    pageUrl: "https://example.com/",
                    clicks: 4,
                    impressions: 40,
                    ctr: 0.1,
                    averagePosition: 3,
                  },
                ],
                report,
              )
            }
          />
        </SeoResultMessagesProvider>
      </NextIntlClientProvider>,
    );
    await pick(
      user,
      screen.getByRole("button", {
        name: "Exportieren: Search-Console-Suchanfragen",
      }),
      "In eine Tabelle kopieren",
    );
    await waitFor(() => expect(m.success).toHaveBeenCalledOnce());
    const [body] = m.create.mock.calls[0];
    expect(body.title).toMatch(/^Search Console queries · example\.com · /);
    expect(body.description).toMatch(/^Copied from SEO on /);
    expect(body.columns.map((column: { name: string }) => column.name)).toEqual(
      [
        "Query",
        "Page",
        "Search clicks",
        "Search impressions",
        "Click-through rate",
        "Average position",
      ],
    );
    expect(Object.values(m.batch.mock.calls[0][1].insert[0].values)).toContain(
      query,
    );
  });

  it("finishes a failed copy on the next press without a second Table or row", async () => {
    m.batch.mockResolvedValueOnce({}).mockRejectedValueOnce(new Error("down"));
    const user = userEvent.setup();
    const button = show();
    await pick(user, button, "Copy to a table");
    await waitFor(() => expect(m.error).toHaveBeenCalledOnce());
    expect(m.error.mock.calls[0][1]).toMatchObject({
      duration: Infinity,
      closeButton: true,
    });
    expect(m.success).not.toHaveBeenCalled();
    await waitFor(() => expect(button).not.toHaveAttribute("aria-busy"));
    await pick(user, button, "Copy to a table");
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
    await pick(user, show("p".repeat(200)), "Copy to a table");
    await waitFor(() => expect(m.success).toHaveBeenCalledOnce());
    const [body] = m.create.mock.calls[0];
    expect(body.title).toHaveLength(160);
    expect(body.title).toMatch(/^Keywords · p+… · \w{3} \d{1,2}, \d{4}$/);
  });

  it.each(["🚀".repeat(100), `p${"🚀".repeat(100)}`])(
    "never cuts an emoji of a long project name in half",
    async (site) => {
      // Both parities: whatever the length of the date, one of the two names puts a pair on the cut.
      const user = userEvent.setup();
      await pick(user, show(site), "Copy to a table");
      await waitFor(() => expect(m.success).toHaveBeenCalledOnce());
      const [body] = m.create.mock.calls[0];
      expect(body.title.length).toBeLessThanOrEqual(160);
      expect(body.title.isWellFormed()).toBe(true);
      expect(body.title).toMatch(/🚀… · \w{3} \d{1,2}, \d{4}$/u);
    },
  );

  it("downloads the table as a dated CSV file from the same menu", async () => {
    const user = userEvent.setup();
    const createObjectURL = vi
      .spyOn(URL, "createObjectURL")
      .mockReturnValue("blob:keywords");
    const revoke = vi
      .spyOn(URL, "revokeObjectURL")
      .mockImplementation(() => {});
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});
    try {
      await pick(user, show(), "Download CSV");
      expect(createObjectURL).toHaveBeenCalledOnce();
      const link = click.mock.contexts[0] as HTMLAnchorElement;
      expect(link.download).toMatch(/^keywords-\d{4}-\d{2}-\d{2}\.csv$/);
      expect(m.create).not.toHaveBeenCalled();
    } finally {
      click.mockRestore();
      createObjectURL.mockRestore();
      revoke.mockRestore();
    }
  });

  it("offers nothing to export when a search left no row, but finishes a failed copy", async () => {
    const user = userEvent.setup();
    const view = render(menu(true));
    const trigger = screen.getByRole("button", { name: "Export: Keywords" });
    await user.click(trigger);
    for (const name of ["Download CSV", "Copy to a table"])
      expect(await screen.findByRole("menuitem", { name })).toHaveAttribute(
        "aria-disabled",
        "true",
      );
    await user.keyboard("{Escape}");
    // A copy that failed before the search emptied the list keeps its rows: the copy item still finishes it.
    view.rerender(menu(false));
    m.batch.mockRejectedValueOnce(new Error("offline"));
    await pick(user, trigger, "Copy to a table");
    await waitFor(() => expect(m.error).toHaveBeenCalledOnce());
    await waitFor(() => expect(trigger).not.toHaveAttribute("aria-busy"));
    view.rerender(menu(true));
    await pick(user, trigger, "Copy to a table");
    await waitFor(() => expect(m.success).toHaveBeenCalledOnce());
    expect(m.create).toHaveBeenCalledOnce();
  });

  it("reports a copy it cannot plan and frees the button", async () => {
    const user = userEvent.setup();
    const button = show("example.com", () => {
      throw new Error("bad table");
    });
    await pick(user, button, "Copy to a table");
    await waitFor(() => expect(m.error).toHaveBeenCalledOnce());
    expect(m.create).not.toHaveBeenCalled();
    await waitFor(() => expect(button).not.toHaveAttribute("aria-busy"));
  });
});
