import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { wizardMountSpy } = vi.hoisted(() => ({ wizardMountSpy: vi.fn() }));

vi.mock("next/dynamic", async () => {
  const { useEffect } = await import("react");
  return {
    default: () =>
      function NewTaskWizardMock({ instance }: { instance: number }) {
        useEffect(() => {
          wizardMountSpy(instance);
        }, [instance]);
        return <div data-testid="new-task-wizard" data-instance={instance} />;
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

  it("reads as unavailable outside the provider", () => {
    render(<NewTaskTrigger />);

    expect(screen.getByText("unavailable")).toBeInTheDocument();
  });
});
