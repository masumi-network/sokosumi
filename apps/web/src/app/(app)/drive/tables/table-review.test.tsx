import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TableCell } from "@/app/drive/tables/table-cell";
import { TableColumnDialog } from "@/app/drive/tables/table-column-dialog";
import { TableCreateDialog } from "@/app/drive/tables/table-create-dialog";
import { TableEditor } from "@/app/drive/tables/table-editor";

const f = vi.hoisted(() => {
  const column = {
    id: "00000000-0000-4000-8000-000000000001",
    tableId: "00000000-0000-4000-8000-000000000002",
    name: "Company",
    description: "",
    type: "text" as const,
    options: [],
    position: 0,
    version: 1,
  };
  const row = {
    id: "00000000-0000-4000-8000-000000000003",
    tableId: column.tableId,
    values: { [column.id]: "Original" },
    evidence: {},
    version: 1,
    archivedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  return {
    column,
    columns: [column],
    tableVersion: 1,
    tableArchived: null as Date | null,
    row,
    shown: [row],
    enrich: vi.fn(),
    batch: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    push: vi.fn(),
  };
});
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
  useFormatter: () => ({ dateTime: () => "date" }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: f.push }) }));
vi.mock("nuqs", async () => {
  const { useState } = await import("react");
  return { useQueryState: () => useState(null) };
});
vi.mock("@/lib/auth/auth.client", () => ({
  useSession: () => ({ data: { session: { activeOrganizationId: null } } }),
}));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: async () => {} }),
  useQuery: ({ queryKey }: { queryKey: string[] }) => ({
    isPending: false,
    error: null,
    refetch: vi.fn(),
    data:
      queryKey[0] === "data-table"
        ? {
            id: f.column.tableId,
            workspaceId: "ws",
            title: "Fixture table",
            description: "",
            version: f.tableVersion,
            columns: f.columns,
            views: [],
            archivedAt: f.tableArchived,
          }
        : queryKey[0] === "table-rows"
          ? { rows: f.shown, nextCursor: null }
          : queryKey[0] === "table-agent-options"
            ? {
                bot: {
                  id: "00000000-0000-4000-8000-000000000004",
                  name: "Bot",
                },
                coworkers: [],
              }
            : queryKey[0] === "table-project-options"
              ? []
              : { items: [] },
  }),
}));
vi.mock("@/lib/services/data-table.client", () => ({
  dataTableService: {
    enrich: f.enrich,
    batch: f.batch,
    create: f.create,
    update: f.update,
    projects: vi.fn(),
    get: vi.fn(),
    query: vi.fn(),
    history: vi.fn(),
    agents: vi.fn(),
  },
}));
beforeEach(() => {
  vi.resetAllMocks();
  f.shown = [f.row];
  f.columns = [f.column];
  f.tableVersion = 1;
  f.tableArchived = null;
});
afterEach(cleanup);
it("F6: invalid enrichment stays editable without sending an invalid request", async () => {
  f.enrich.mockRejectedValue(new Error("Choose one agent"));
  render(<TableEditor id={f.column.tableId} />);
  fireEvent.click(screen.getByRole("checkbox", { name: "selectRow" }));
  fireEvent.click(screen.getByRole("button", { name: "askAgent" }));
  fireEvent.change(screen.getByLabelText("instruction"), {
    target: { value: "Find price" },
  });
  fireEvent.click(screen.getByRole("button", { name: "createTask" }));
  await waitFor(() =>
    expect(screen.getAllByRole("alert")[0]).toHaveTextContent(
      "enrichmentRequired",
    ),
  );
  expect(f.enrich).not.toHaveBeenCalled();
  await waitFor(() =>
    expect(screen.getByLabelText("instruction")).not.toBeDisabled(),
  );
  expect(screen.getByLabelText("agent")).not.toBeDisabled();
  expect(screen.getByRole("checkbox", { name: "Company" })).not.toBeDisabled();
});
it("F4: add-row lost-ack retry preserves the exact request", async () => {
  f.batch
    .mockRejectedValueOnce(new Error("network lost acknowledgement"))
    .mockResolvedValue({ rows: [] });
  render(<TableEditor id={f.column.tableId} />);
  fireEvent.click(screen.getByRole("button", { name: "addRow" }));
  await waitFor(() =>
    expect(screen.getByRole("alert")).toHaveTextContent("network lost"),
  );
  fireEvent.click(screen.getByRole("button", { name: "retry" }));
  await waitFor(() => expect(f.batch).toHaveBeenCalledTimes(2));
  expect(f.batch.mock.calls[0][1]).toEqual(f.batch.mock.calls[1][1]);
});
it("F2: polling row removal pins the edited row and preserves its original version", async () => {
  f.batch.mockResolvedValue({ rows: [] });
  const { rerender } = render(<TableEditor id={f.column.tableId} />);
  const cell = screen.getByRole("textbox", { name: "Company" });
  fireEvent.focus(cell);
  fireEvent.change(cell, { target: { value: "Unsaved draft" } });
  expect(cell).toHaveValue("Unsaved draft");
  f.shown = [];
  rerender(<TableEditor id={f.column.tableId} />);
  expect(screen.getByRole("textbox", { name: "Company" })).toHaveValue(
    "Unsaved draft",
  );
  f.shown = [{ ...f.row, version: 2 }];
  rerender(<TableEditor id={f.column.tableId} />);
  expect(screen.getByRole("textbox", { name: "Company" })).toHaveValue(
    "Unsaved draft",
  );
  expect(f.batch).not.toHaveBeenCalled();
  fireEvent.blur(screen.getByRole("textbox", { name: "Company" }));
  await waitFor(() => expect(f.batch).toHaveBeenCalledOnce());
  expect(f.batch.mock.calls[0][1].patch[0].version).toBe(1);
});
it("F11: typing after Escape starts another edit", () => {
  const save = vi.fn();
  render(
    <TableCell
      column={f.column}
      row={f.row}
      disabled={false}
      onSave={save}
      onHistory={() => {}}
    />,
  );
  const cell = screen.getByRole("textbox", { name: "Company" });
  fireEvent.focus(cell);
  fireEvent.change(cell, { target: { value: "Cancelled" } });
  fireEvent.keyDown(cell, { key: "Escape" });
  fireEvent.change(cell, { target: { value: "New edit" } });
  fireEvent.blur(cell);
  expect(save).toHaveBeenCalledWith(1, "New edit");
});
it("F3: legal large CSV is byte-bounded and retries the same chunk", async () => {
  f.create.mockResolvedValue({ id: f.column.tableId });
  f.batch
    .mockRejectedValueOnce(new Error("Lost acknowledgement"))
    .mockImplementation(async (_id, body) => {
      expect(
        new TextEncoder().encode(JSON.stringify(body)).byteLength,
      ).toBeLessThan(1000000);
      return { rows: [] };
    });
  render(<TableCreateDialog workspaceId={null} />);
  fireEvent.click(screen.getByRole("button", { name: "newTable" }));
  fireEvent.change(screen.getByLabelText("title"), {
    target: { value: "CSV" },
  });
  const csv =
    "Notes\n" + Array.from({ length: 60 }, () => "x".repeat(20000)).join("\n");
  const file = { size: csv.length, text: async () => csv };
  fireEvent.change(screen.getByLabelText("importCsv"), {
    target: { files: [file] },
  });
  await waitFor(() =>
    expect(screen.getByLabelText("type")).toBeInTheDocument(),
  );
  fireEvent.change(screen.getByLabelText("type"), {
    target: { value: "long_text" },
  });
  fireEvent.click(screen.getByRole("button", { name: "create" }));
  await waitFor(() =>
    expect(screen.getByRole("alert")).toHaveTextContent("Lost acknowledgement"),
  );
  expect(f.create).toHaveBeenCalledOnce();
  expect(f.push).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "retry" }));
  await waitFor(() =>
    expect(f.push).toHaveBeenCalledWith(`/drive/tables/${f.column.tableId}`),
  );
  expect(f.batch.mock.calls[0]).toEqual(f.batch.mock.calls[1]);
  expect(
    f.batch.mock.calls
      .slice(1)
      .reduce((n, call) => n + call[1].insert.length, 0),
  ).toBe(60);
});
it.each([
  { type: "date", partial: "2", complete: "2026-09-18" },
  { type: "number", partial: "-", complete: "-2" },
  { type: "checkbox", partial: "t", complete: "true" },
])(
  "F7: $type filters retain partial input until blur",
  ({ type, partial, complete }) => {
    Object.assign(f.column, { type });
    try {
      render(<TableEditor id={f.column.tableId} />);
      fireEvent.click(screen.getByRole("button", { name: "configureView" }));
      fireEvent.change(screen.getByLabelText("filter"), {
        target: { value: f.column.id },
      });
      fireEvent.change(screen.getByLabelText("operator"), {
        target: { value: "equals" },
      });
      const value = screen.getByLabelText("filterValue");
      fireEvent.change(value, { target: { value: partial } });
      expect(value).toHaveValue(partial);
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      fireEvent.change(value, { target: { value: complete } });
      fireEvent.blur(value);
      expect(value).toHaveValue(complete);
    } finally {
      Object.assign(f.column, { type: "text" });
    }
  },
);

it.each(["UnprocessableEntity", "Forbidden"])(
  "F6: releases fields after definitive %s rejection",
  async (error) => {
    f.enrich
      .mockRejectedValueOnce({ error, message: "Rejected" })
      .mockResolvedValue({ taskId: "task" });
    render(<TableEditor id={f.column.tableId} />);
    fireEvent.click(screen.getByRole("checkbox", { name: "selectRow" }));
    fireEvent.click(screen.getByRole("button", { name: "askAgent" }));
    fireEvent.change(screen.getByLabelText("instruction"), {
      target: { value: "Find pricing" },
    });
    fireEvent.change(screen.getByLabelText("agent"), {
      target: { value: "bot:00000000-0000-4000-8000-000000000004" },
    });
    fireEvent.click(screen.getByRole("checkbox", { name: "Company" }));
    fireEvent.click(screen.getByRole("button", { name: "createTask" }));
    await waitFor(() => expect(f.enrich).toHaveBeenCalledOnce());
    await waitFor(() =>
      expect(screen.getByLabelText("instruction")).not.toBeDisabled(),
    );
    expect(screen.getByLabelText("agent")).not.toBeDisabled();
    fireEvent.change(screen.getByLabelText("instruction"), {
      target: { value: "Corrected pricing" },
    });
    fireEvent.click(screen.getByRole("button", { name: "createTask" }));
    await waitFor(() => expect(f.enrich).toHaveBeenCalledTimes(2));
    expect(f.enrich.mock.calls[1][1].prompt).toBe("Corrected pricing");
    expect(f.enrich.mock.calls[1][1].key).not.toBe(
      f.enrich.mock.calls[0][1].key,
    );
  },
);
it("F6: ambiguous enrichment errors retain the exact request", async () => {
  f.enrich
    .mockRejectedValueOnce(new TypeError("network"))
    .mockResolvedValue({ taskId: "task" });
  render(<TableEditor id={f.column.tableId} />);
  fireEvent.click(screen.getByRole("checkbox", { name: "selectRow" }));
  fireEvent.click(screen.getByRole("button", { name: "askAgent" }));
  fireEvent.change(screen.getByLabelText("instruction"), {
    target: { value: "Find pricing" },
  });
  fireEvent.change(screen.getByLabelText("agent"), {
    target: { value: "bot:00000000-0000-4000-8000-000000000004" },
  });
  fireEvent.click(screen.getByRole("checkbox", { name: "Company" }));
  fireEvent.click(screen.getByRole("button", { name: "createTask" }));
  await waitFor(() =>
    expect(screen.getAllByRole("alert")[0]).toHaveTextContent("network"),
  );
  expect(screen.getByLabelText("instruction")).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "createTask" }));
  await waitFor(() => expect(f.enrich).toHaveBeenCalledTimes(2));
  expect(f.enrich.mock.calls[0]).toEqual(f.enrich.mock.calls[1]);
});
it("F2: canceling deliberate view navigation keeps the draft", () => {
  const confirm = vi.fn().mockReturnValue(false);
  vi.stubGlobal("confirm", confirm);
  render(<TableEditor id={f.column.tableId} />);
  const input = screen.getByLabelText("Company");
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: "Keep draft" } });
  fireEvent.change(screen.getByLabelText("view"), { target: { value: "" } });
  expect(confirm).toHaveBeenCalled();
  expect(input).toHaveValue("Keep draft");
  vi.unstubAllGlobals();
});

it.each(["disappeared", "updated"])(
  "R1: explicit archive retry survives a %s row",
  async (change) => {
    f.batch
      .mockRejectedValueOnce(new TypeError("lost acknowledgement"))
      .mockResolvedValue({ rows: [] });
    const view = render(<TableEditor id={f.column.tableId} />);
    fireEvent.click(screen.getByRole("checkbox", { name: "selectRow" }));
    fireEvent.click(screen.getByRole("button", { name: "archiveRows" }));
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    f.shown = change === "disappeared" ? [] : [{ ...f.row, version: 2 }];
    view.rerender(<TableEditor id={f.column.tableId} />);
    fireEvent.click(screen.getByRole("button", { name: "addRow" }));
    expect(f.batch).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("alert")).toHaveTextContent("errors.unresolved");
    fireEvent.click(screen.getByRole("button", { name: "retry" }));
    await waitFor(() => expect(f.batch).toHaveBeenCalledTimes(2));
    expect(f.batch.mock.calls[1]).toEqual(f.batch.mock.calls[0]);
    expect(f.batch.mock.calls[1][1].patch).toEqual([
      { id: f.row.id, version: 1, archived: true },
    ]);
    await waitFor(() =>
      expect(screen.queryByRole("alert")).not.toBeInTheDocument(),
    );
  },
);

it("R1: table archive retry preserves pre-poll metadata and intent", async () => {
  f.update
    .mockRejectedValueOnce(new TypeError("lost acknowledgement"))
    .mockResolvedValue({});
  const view = render(<TableEditor id={f.column.tableId} />);
  fireEvent.pointerDown(screen.getByRole("button", { name: "tableMenu" }), {
    button: 0,
    ctrlKey: false,
  });
  fireEvent.click(await screen.findByRole("menuitem", { name: "archive" }));
  fireEvent.click(screen.getByRole("button", { name: "save" }));
  await waitFor(() => expect(f.update).toHaveBeenCalledOnce());
  await waitFor(() =>
    expect(
      screen.getAllByRole("button", { name: "retry" }).length,
    ).toBeGreaterThan(0),
  );
  f.tableVersion = 2;
  f.tableArchived = new Date();
  view.rerender(<TableEditor id={f.column.tableId} />);
  fireEvent.click(screen.getAllByRole("button", { name: "retry" })[0]);
  await waitFor(() => expect(f.update).toHaveBeenCalledTimes(2));
  expect(f.update.mock.calls[1]).toEqual(f.update.mock.calls[0]);
  expect(f.update.mock.calls[1][1]).toMatchObject({
    version: 1,
    archived: true,
  });
});
it("R1: reorder retry retains original column IDs and ordering after polling", async () => {
  const second = {
    ...f.column,
    id: "00000000-0000-4000-8000-000000000005",
    name: "Second",
    position: 1,
  };
  f.columns = [f.column, second];
  f.update
    .mockRejectedValueOnce(new TypeError("lost acknowledgement"))
    .mockResolvedValue({});
  const view = render(<TableEditor id={f.column.tableId} />);
  fireEvent.pointerDown(
    screen.getAllByRole("button", { name: "columnMenu" })[0],
    {
      button: 0,
      ctrlKey: false,
    },
  );
  fireEvent.click(await screen.findByRole("menuitem", { name: "moveRight" }));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "retry" })).toBeInTheDocument(),
  );
  f.tableVersion = 2;
  f.columns = [second, f.column];
  view.rerender(<TableEditor id={f.column.tableId} />);
  fireEvent.click(screen.getByRole("button", { name: "retry" }));
  await waitFor(() => expect(f.update).toHaveBeenCalledTimes(2));
  expect(f.update.mock.calls[1]).toEqual(f.update.mock.calls[0]);
  expect(
    f.update.mock.calls[1][1].columns.map((c: { id: string }) => c.id),
  ).toEqual([second.id, f.column.id]);
});
it("R1: column dialog freezes ambiguous input and retries its original schema", async () => {
  f.update
    .mockRejectedValueOnce(new TypeError("lost acknowledgement"))
    .mockResolvedValue({});
  const table = {
    id: f.column.tableId,
    workspaceId: "ws",
    title: "Table",
    description: "",
    version: 1,
    columns: [f.column],
    views: [],
    archivedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    projectId: null,
    createdBy: "user",
  };
  const onClose = vi.fn();
  const view = render(
    <TableColumnDialog
      table={table}
      column={f.column}
      onClose={onClose}
      onSaved={vi.fn()}
    />,
  );
  fireEvent.change(screen.getByLabelText("columnName"), {
    target: { value: "Renamed" },
  });
  fireEvent.click(screen.getByRole("button", { name: "save" }));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "retry" })).toBeInTheDocument(),
  );
  expect(screen.getByLabelText("columnName")).toBeDisabled();
  view.rerender(
    <TableColumnDialog
      table={{ ...table, version: 2 }}
      column={{ ...f.column, name: "Polled" }}
      onClose={onClose}
      onSaved={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "retry" }));
  await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  expect(f.update.mock.calls[1]).toEqual(f.update.mock.calls[0]);
});
