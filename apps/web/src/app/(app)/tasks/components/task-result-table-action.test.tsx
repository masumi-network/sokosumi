import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, expect, it, vi } from "vitest";
import { ExpandableMarkdown } from "@/components/expandable-markdown";
import Markdown from "@/components/markdown";
import { createFormats } from "@/i18n/time-format";
import messages from "../../../../../messages/en.json";
import { useTaskResultTableComponents } from "./task-result-table-action";

const m = vi.hoisted(() => ({
  create: vi.fn(),
  batch: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}));
vi.mock("@/lib/services/data-table.client", () => ({
  dataTableService: { create: m.create, batch: m.batch },
}));
vi.mock("sonner", () => ({ toast: { success: m.success, error: m.error } }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

const RESULT = `Here are the leads:

| Company | ZIP | Employees |
| --- | --- | --- |
| **Acme** | 01234 | 12 |
| Globex | 98765 | 300 |
`;

function Result() {
  const components = useTaskResultTableComponents({
    title: "Find leads",
    projectId: "00000000-0000-4000-8000-000000000001",
  });
  return <Markdown components={components}>{RESULT}</Markdown>;
}

function show() {
  render(
    <NextIntlClientProvider
      locale="en"
      messages={messages}
      timeZone="UTC"
      formats={createFormats()}
    >
      <Result />
    </NextIntlClientProvider>,
  );
  return screen.getByRole("button", { name: "Save as table" });
}

beforeEach(() => {
  m.create.mockReset().mockResolvedValue({ id: "table-1" });
  m.batch.mockReset().mockResolvedValue({});
  m.success.mockReset();
  m.error.mockReset();
});

it("saves the table as the reader sees it and then links to it", async () => {
  const user = userEvent.setup();
  await user.click(show());

  const [table] = m.create.mock.calls[0];
  expect(table).toMatchObject({
    title: "Find leads table",
    projectId: "00000000-0000-4000-8000-000000000001",
  });
  expect(table.columns.map((c: { type: string }) => c.type)).toEqual([
    "text",
    "text",
    "number",
  ]);
  const [, batch] = m.batch.mock.calls[0];
  expect(Object.values(batch.insert[0].values)).toEqual(["Acme", "01234", 12]);
  expect(m.success).toHaveBeenCalledWith(
    "Saved 2 rows to a new table.",
    expect.anything(),
  );
  expect(screen.getByRole("link", { name: "Open table" })).toHaveAttribute(
    "href",
    "/drive/tables/table-1",
  );
});

it("says how far a failed save got and finishes it on the next press", async () => {
  m.batch.mockRejectedValueOnce(new Error("offline"));
  const user = userEvent.setup();
  const button = show();
  await user.click(button);
  expect(m.error).toHaveBeenCalledWith(
    "Couldn't save the table. Try again.",
    expect.anything(),
  );

  await user.click(button);
  expect(m.create).toHaveBeenCalledTimes(1);
  expect(m.batch).toHaveBeenCalledTimes(2);
  expect(screen.getByRole("link", { name: "Open table" })).toBeInTheDocument();
});

it("refuses a table too large to save whole, before creating anything", async () => {
  const user = userEvent.setup();
  render(
    <NextIntlClientProvider
      locale="en"
      messages={messages}
      timeZone="UTC"
      formats={createFormats()}
    >
      <WideResult />
    </NextIntlClientProvider>,
  );
  await user.click(screen.getByRole("button", { name: "Save as table" }));
  expect(m.create).not.toHaveBeenCalled();
  expect(m.error).toHaveBeenCalledWith(
    messages.App.Tasks.Detail.saveTable.tooLarge,
    expect.anything(),
  );
});

function WideResult() {
  const components = useTaskResultTableComponents({
    title: "Wide",
    projectId: null,
  });
  const columns = Array.from({ length: 101 }, (_, i) => `c${i}`);
  return (
    <Markdown components={components}>
      {`| ${columns.join(" | ")} |\n|${columns.map(() => " --- ").join("|")}|\n| ${columns.join(" | ")} |\n`}
    </Markdown>
  );
}

function Collapsible() {
  const components = useTaskResultTableComponents({
    title: "Find leads",
    projectId: null,
  });
  return (
    <ExpandableMarkdown
      content={RESULT}
      expandLabel="Expand"
      collapseLabel="Show less"
      components={components}
    />
  );
}

function renderCollapsible() {
  render(
    <NextIntlClientProvider
      locale="en"
      messages={messages}
      timeZone="UTC"
      formats={createFormats()}
    >
      <Collapsible />
    </NextIntlClientProvider>,
  );
}

/** The action row, which stays in the layout whether or not the activity is clipped. */
const actionRow = () =>
  screen.getByText("Save as table").closest("div") as HTMLElement;

it("keeps the action out of reach while the table is clipped, and offers it once expanded", async () => {
  // happy-dom lays nothing out: report content taller than the clamp.
  vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(1000);
  const user = userEvent.setup();
  renderCollapsible();
  const expand = await screen.findByRole("button", { name: "Expand" });
  expect(actionRow()).toHaveAttribute("inert");

  await user.click(expand);
  expect(actionRow()).not.toHaveAttribute("inert");
  await user.click(screen.getByRole("button", { name: "Save as table" }));
  expect(m.create).toHaveBeenCalledTimes(1);
});

it("lays out the same whether clipped or not, so the action alone cannot flip the clamp", async () => {
  // Only the action's height pushes the content past the clamp.
  vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockImplementation(
    function (this: HTMLElement) {
      return this.querySelector("[data-table-action]") ? 1000 : 0;
    },
  );
  renderCollapsible();
  await screen.findByRole("button", { name: "Expand" });
  // Clipping keeps the action in the layout (inert), so the measure that clipped it still holds.
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(screen.getByRole("button", { name: "Expand" })).toBeInTheDocument();
  expect(actionRow()).toHaveAttribute("inert");
});
