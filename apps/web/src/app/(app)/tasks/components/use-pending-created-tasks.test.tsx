import { act, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { TaskWithCoworker } from "@/app/tasks/types/task-board";
import type { CreateTaskResult } from "@/lib/actions/task/action";
import type { TaskFormCreateInput } from "./task-form";
import {
  usePendingCreatedTasks,
  withBoardPreview,
} from "./use-pending-created-tasks";

vi.mock("@/lib/actions/task/action", () => ({ createTask: vi.fn() }));
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

const input = { name: "New task", description: "" } as TaskFormCreateInput;
const buildPendingTask = (created: TaskFormCreateInput) =>
  ({
    id: "pending:1",
    name: created.name,
    isPending: true,
  }) as TaskWithCoworker;

function Board({ items }: { items: TaskWithCoworker[] }) {
  const rows = usePendingCreatedTasks(items, buildPendingTask);
  return (
    <ul>
      {rows.map((row) => (
        <li key={row.id}>{row.isPending ? `pending ${row.name}` : row.name}</li>
      ))}
    </ul>
  );
}

function deferredCreate() {
  let finish: (result: CreateTaskResult) => void = () => {};
  const handler = vi.fn(
    () => new Promise<CreateTaskResult>((resolve) => (finish = resolve)),
  );
  return { handler, finish: (result: CreateTaskResult) => finish(result) };
}

describe("pending created tasks", () => {
  it("shows the row while the create runs and drops it when the create fails", async () => {
    const { handler, finish } = deferredCreate();
    render(<Board items={[]} />);

    let created: Promise<CreateTaskResult> | undefined;
    await act(async () => {
      created = withBoardPreview(handler)(input);
    });

    expect(screen.getByText("pending New task")).toBeInTheDocument();

    await act(async () => {
      finish({ ok: false } as CreateTaskResult);
      await created;
    });

    expect(screen.queryByText("pending New task")).not.toBeInTheDocument();
  });

  it("names a nameless row the way the create failure toast does", async () => {
    const { handler, finish } = deferredCreate();
    render(<Board items={[]} />);

    let created: Promise<CreateTaskResult> | undefined;
    await act(async () => {
      created = withBoardPreview(handler)({
        name: "",
        description: "![](https://example.com/a.png)",
      } as TaskFormCreateInput);
    });

    expect(screen.getByText("pending untitledTask")).toBeInTheDocument();

    await act(async () => {
      finish({ ok: false } as CreateTaskResult);
      await created;
    });
  });

  it("leaves one row when the real Task arrives with the answer", async () => {
    const { handler, finish } = deferredCreate();
    const { rerender } = render(<Board items={[]} />);

    let created: Promise<CreateTaskResult> | undefined;
    await act(async () => {
      created = withBoardPreview(handler)(input);
    });
    await act(async () => {
      rerender(
        <Board
          items={[{ id: "task-1", name: "New task" } as TaskWithCoworker]}
        />,
      );
      finish({ ok: true } as CreateTaskResult);
      await created;
    });

    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    expect(screen.getByText("New task")).toBeInTheDocument();
  });

  it("still sends the create when the preview row cannot be built", async () => {
    const handler = vi.fn().mockResolvedValue({ ok: true });
    function BrokenBoard() {
      usePendingCreatedTasks([], () => {
        throw new Error("no preview");
      });
      return null;
    }
    render(<BrokenBoard />);

    let result: CreateTaskResult | undefined;
    await act(async () => {
      result = await withBoardPreview(handler)(input);
    });

    expect(result).toEqual({ ok: true });
  });
});
