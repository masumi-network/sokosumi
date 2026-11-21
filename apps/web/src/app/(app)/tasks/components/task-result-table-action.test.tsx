import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, expect, it, vi } from "vitest";
import { ExpandableMarkdown } from "@/components/expandable-markdown";
import Markdown from "@/components/markdown";
import { createFormats } from "@/i18n/time-format";
import messages from "../../../../../messages/en.json";
import { taskTableSource } from "./task-result-table";
import { useTaskResultTableComponents } from "./task-result-table-action";
import { TaskTableEvent } from "./task-table-event";

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

/** Saved Tables outlive the row, keyed by Task: each test gets its own Task. */
let taskId = 0;
beforeEach(() => {
  taskId++;
});

type Where = {
  /** The activity events, one comment each; null is a comment not saved yet. */
  events?: (string | null)[];
};

function Result({ events = ["event-1"] }: Where) {
  const components = useTaskResultTableComponents({
    taskId: `task-${taskId}`,
    workspaceId: "workspace-1",
    title: "Find leads",
    projectId: "00000000-0000-4000-8000-000000000001",
  });
  return events.map((event) => (
    <TaskTableEvent key={event} value={event}>
      <Markdown components={components}>{RESULT}</Markdown>
    </TaskTableEvent>
  ));
}

function show() {
  renderResult();
  return screen.getByRole("button", { name: "Save as table" });
}

function renderResult(where: Where = {}) {
  return render(
    <NextIntlClientProvider
      locale="en"
      messages={messages}
      timeZone="UTC"
      formats={createFormats()}
    >
      <Result {...where} />
    </NextIntlClientProvider>,
  );
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
  // The row keeps the link, so the toast goes by itself: on a phone it covers the comment Submit.
  expect(m.success.mock.calls[0][1]).not.toHaveProperty("duration");
  expect(screen.getByRole("link", { name: "Open table" })).toHaveAttribute(
    "href",
    "/drive/tables/table-1",
  );
});

it("keeps the link when the row mounts again, so a second press cannot make a second Table", async () => {
  const user = userEvent.setup();
  const first = renderResult();
  await user.click(screen.getByRole("button", { name: "Save as table" }));
  first.unmount();

  // A new activity event or a layout switch mounts the comment afresh.
  renderResult();
  expect(screen.getByRole("link", { name: "Open table" })).toHaveAttribute(
    "href",
    "/drive/tables/table-1",
  );
  expect(
    screen.queryByRole("button", { name: "Save as table" }),
  ).not.toBeInTheDocument();
  expect(m.create).toHaveBeenCalledTimes(1);
});

it("keeps the same table in another activity event its own copy", async () => {
  const user = userEvent.setup();
  renderResult({ events: ["event-1", "event-2"] });
  const [first] = screen.getAllByRole("button", { name: "Save as table" });
  await user.click(first);
  expect(screen.getAllByRole("link", { name: "Open table" })).toHaveLength(1);
  expect(screen.getAllByRole("button", { name: "Save as table" })).toHaveLength(
    1,
  );
});

it("starts a fresh copy once the Task moves to another workspace", async () => {
  // A move changes the workspace only: the Task id, its billing organization and its (empty) project stay.
  const task = {
    id: `task-${taskId}`,
    name: "Find leads",
    projectId: null,
    visibility: "PUBLIC" as const,
    organizationId: "org-1",
  };
  const user = userEvent.setup();
  const before = renderSource(
    taskTableSource({ ...task, workspace: { id: "workspace-1" } }),
  );
  await user.click(screen.getByRole("button", { name: "Save as table" }));
  before.unmount();

  renderSource(taskTableSource({ ...task, workspace: { id: "workspace-2" } }));
  expect(
    screen.queryByRole("link", { name: "Open table" }),
  ).not.toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Save as table" }),
  ).toBeInTheDocument();
});

function SourceResult({
  source,
}: {
  source: ReturnType<typeof taskTableSource>;
}) {
  const components = useTaskResultTableComponents(source ?? null);
  return (
    <TaskTableEvent value="event-1">
      <Markdown components={components}>{RESULT}</Markdown>
    </TaskTableEvent>
  );
}

function renderSource(source: ReturnType<typeof taskTableSource>) {
  return render(
    <NextIntlClientProvider
      locale="en"
      messages={messages}
      timeZone="UTC"
      formats={createFormats()}
    >
      <SourceResult source={source} />
    </NextIntlClientProvider>,
  );
}

it("offers nothing on a comment not saved yet, whose row is replaced once it is", () => {
  renderResult({ events: [null] });
  expect(screen.getByRole("table")).toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Save as table" }),
  ).not.toBeInTheDocument();
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
    taskId: `task-${taskId}`,
    workspaceId: "workspace-1",
    title: "Wide",
    projectId: null,
  });
  const columns = Array.from({ length: 101 }, (_, i) => `c${i}`);
  return (
    <TaskTableEvent value="event-1">
      <Markdown components={components}>
        {`| ${columns.join(" | ")} |\n|${columns.map(() => " --- ").join("|")}|\n| ${columns.join(" | ")} |\n`}
      </Markdown>
    </TaskTableEvent>
  );
}

function Collapsible() {
  const components = useTaskResultTableComponents({
    taskId: `task-${taskId}`,
    workspaceId: "workspace-1",
    title: "Find leads",
    projectId: null,
  });
  return (
    <TaskTableEvent value="event-1">
      <ExpandableMarkdown
        content={RESULT}
        expandLabel="Expand"
        collapseLabel="Show less"
        components={components}
      />
    </TaskTableEvent>
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
  // Hidden, not faded: nothing under the clamp looks like a live control.
  expect(actionRow()).toHaveAttribute("inert");
  expect(actionRow()).toHaveClass("invisible");

  await user.click(expand);
  expect(actionRow()).not.toHaveAttribute("inert");
  expect(actionRow()).not.toHaveClass("invisible");
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
