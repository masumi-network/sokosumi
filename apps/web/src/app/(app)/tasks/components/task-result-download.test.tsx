import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, expect, it, vi } from "vitest";
import messages from "../../../../../messages/en.json";
import { TaskResultDownload } from "./task-result-download";

const m = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({
  toast: { success: m.success, error: m.error, loading: vi.fn() },
}));

const RESULT = `# Leads

See [Acme](https://acme.test).

- first
- second

| Company | Employees |
| --- | --- |
| Acme | 12 |
`;

/** Stands in for the browser's ClipboardItem: keeps what each type resolves to. */
class FakeClipboardItem {
  constructor(readonly items: Record<string, Promise<Blob> | Blob>) {}
}

async function textOf(item: FakeClipboardItem, type: string) {
  return (await item.items[type]).text();
}

function stubClipboard(withItems: boolean) {
  const clipboard = {
    write: vi.fn().mockResolvedValue(undefined),
    writeText: vi.fn().mockResolvedValue(undefined),
  };
  vi.stubGlobal("navigator", { ...navigator, clipboard });
  vi.stubGlobal("ClipboardItem", withItems ? FakeClipboardItem : undefined);
  return clipboard;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function renderRow() {
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <TaskResultDownload markdown={RESULT} fileName="Find leads" />
    </NextIntlClientProvider>,
  );
}

async function copy() {
  renderRow();
  await userEvent.click(screen.getByRole("button", { name: "Copy" }));
}

it("shows Copy and Download as named icon buttons without visible text", () => {
  renderRow();

  for (const name of ["Copy", "Download"]) {
    const button = screen.getByRole("button", { name });
    expect(button).toHaveAttribute("aria-label", name);
    expect(button.textContent).toBe("");
  }
});

it("opens the download menu from the keyboard with its PDF and Word items", async () => {
  renderRow();

  await userEvent.tab();
  await userEvent.tab();
  expect(screen.getByRole("button", { name: "Download" })).toHaveFocus();
  await userEvent.keyboard("{Enter}");

  expect(
    await screen.findByRole("menuitem", { name: "Export as PDF" }),
  ).toBeVisible();
  expect(
    screen.getByRole("menuitem", { name: "Export as Word document" }),
  ).toBeVisible();
});

it("copies the result as formatted HTML with the Markdown as plain text", async () => {
  const clipboard = stubClipboard(true);

  await copy();

  const [item] = clipboard.write.mock.calls[0][0] as FakeClipboardItem[];
  const html = await textOf(item, "text/html");
  expect(html).toContain("<h1>Leads</h1>");
  expect(html).toContain('<a href="https://acme.test">Acme</a>');
  expect(html).toContain("<li>first</li>");
  expect(html).toMatch(/<table>[\s\S]*<td>Acme<\/td>/);
  expect(await textOf(item, "text/plain")).toBe(RESULT);
  expect(m.success).toHaveBeenCalledWith("Result copied with formatting");
});

it("copies the Markdown where the browser cannot copy formatting", async () => {
  const clipboard = stubClipboard(false);

  await copy();

  expect(clipboard.writeText).toHaveBeenCalledWith(RESULT);
  expect(m.success).toHaveBeenCalledWith("Result copied to clipboard");
});

it("says so when the copy fails", async () => {
  const clipboard = stubClipboard(true);
  clipboard.write.mockRejectedValue(new Error("denied"));

  await copy();

  expect(m.error).toHaveBeenCalledWith("Failed to copy result");
});
