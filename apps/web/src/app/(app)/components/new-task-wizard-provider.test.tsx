import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { wizardMountSpy, wizardModuleLoadSpy } = vi.hoisted(() => ({
  wizardMountSpy: vi.fn(),
  wizardModuleLoadSpy: vi.fn(),
}));

vi.mock("./new-task-wizard", () => {
  wizardModuleLoadSpy();
  return { NewTaskWizard: () => null };
});

vi.mock("next/dynamic", async () => {
  const { useEffect } = await import("react");
  return {
    default: () =>
      function NewTaskWizardMock({
        instance,
        onClose,
      }: {
        instance: number;
        onClose?: () => void;
      }) {
        useEffect(() => {
          wizardMountSpy(instance);
        }, [instance]);
        return (
          <div data-testid="new-task-wizard" data-instance={instance}>
            <button type="button" onClick={onClose}>
              Close
            </button>
          </div>
        );
      },
  };
});

import {
  NewTaskWizardProvider,
  useOptionalNewTaskWizard,
} from "./new-task-wizard-provider";

function NewTaskTrigger() {
  const wizard = useOptionalNewTaskWizard();
  if (!wizard) return <span>unavailable</span>;

  return (
    <button type="button" onClick={wizard.openNewTaskWizard}>
      New Task
    </button>
  );
}

describe("NewTaskWizardProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("mounts the wizard only once New Task is opened", () => {
    render(
      <NewTaskWizardProvider>
        <NewTaskTrigger />
      </NewTaskWizardProvider>,
    );

    expect(screen.queryByTestId("new-task-wizard")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "New Task" }));

    expect(screen.getByTestId("new-task-wizard")).toHaveAttribute(
      "data-instance",
      "1",
    );
  });

  it("mounts a fresh wizard on every open", () => {
    render(
      <NewTaskWizardProvider>
        <NewTaskTrigger />
      </NewTaskWizardProvider>,
    );
    const button = screen.getByRole("button", { name: "New Task" });

    fireEvent.click(button);
    fireEvent.click(button);

    expect(wizardMountSpy.mock.calls.map(([instance]) => instance)).toEqual([
      1, 2,
    ]);
    expect(screen.getByTestId("new-task-wizard")).toHaveAttribute(
      "data-instance",
      "2",
    );
  });

  it("unmounts the wizard on close so the next open is a new mount", () => {
    render(
      <NewTaskWizardProvider>
        <NewTaskTrigger />
      </NewTaskWizardProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "New Task" }));
    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    expect(screen.queryByTestId("new-task-wizard")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "New Task" }));

    expect(screen.getByTestId("new-task-wizard")).toHaveAttribute(
      "data-instance",
      "2",
    );
  });

  it("warms the wizard chunk once the shell is idle", async () => {
    const requestIdleCallback = vi.fn((callback: () => void) => {
      callback();
      return 1;
    });
    Object.assign(window, { requestIdleCallback, cancelIdleCallback: vi.fn() });

    render(
      <NewTaskWizardProvider>
        <NewTaskTrigger />
      </NewTaskWizardProvider>,
    );

    expect(requestIdleCallback).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(wizardModuleLoadSpy).toHaveBeenCalled());
    expect(screen.queryByTestId("new-task-wizard")).toBeNull();
  });

  it("reads as unavailable outside the provider", () => {
    render(<NewTaskTrigger />);

    expect(screen.getByText("unavailable")).toBeInTheDocument();
  });
});
