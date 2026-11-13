import type { TaskStatus } from "@sokosumi/core-client";
import { act, render, screen } from "@testing-library/react";
import { type ReactNode, startTransition } from "react";
import { describe, expect, it } from "vitest";
import {
  TaskDetailStatusProvider,
  useOptimisticTaskStatus,
} from "./task-detail-optimistic";

let finishWrite: () => void = () => {};

/** Stands in for the header menu: writes a status inside a transition. */
function Menu({ status }: { status: TaskStatus }) {
  const [, showStatus] = useOptimisticTaskStatus(status);
  return (
    <button
      type="button"
      onClick={() =>
        startTransition(async () => {
          showStatus("COMPLETED");
          await new Promise<void>((resolve) => (finishWrite = resolve));
        })
      }
    >
      complete
    </button>
  );
}

/** Stands in for the Properties panel: only reads the status. */
function Panel({ status }: { status: TaskStatus }) {
  const [shown] = useOptimisticTaskStatus(status);
  return <p>panel {shown}</p>;
}

function renderPage(wrap: (children: ReactNode) => ReactNode) {
  return render(
    wrap(
      <>
        <Menu status="READY" />
        <Panel status="READY" />
      </>,
    ),
  );
}

describe("task detail status", () => {
  it("shows a menu change in the panel until the write ends", async () => {
    renderPage((children) => (
      <TaskDetailStatusProvider status="READY">
        {children}
      </TaskDetailStatusProvider>
    ));

    await act(async () => screen.getByRole("button").click());
    expect(screen.getByText("panel COMPLETED")).toBeInTheDocument();

    // No new status arrived from the server: the write failed.
    await act(async () => finishWrite());
    expect(screen.getByText("panel READY")).toBeInTheDocument();
  });

  it("keeps the status local without a provider", async () => {
    renderPage((children) => children);

    await act(async () => screen.getByRole("button").click());
    expect(screen.getByText("panel READY")).toBeInTheDocument();
    await act(async () => finishWrite());
  });
});
