import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { toastErrorMock } = vi.hoisted(() => ({
  toastErrorMock: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: {
    error: toastErrorMock,
  },
}));

import { useNewTaskWizardLoadError } from "./use-new-task-wizard-load-error";

describe("useNewTaskWizardLoadError", () => {
  beforeEach(() => {
    toastErrorMock.mockReset();
  });

  it("toasts and closes when isError flips true and reacts to new translator identity", () => {
    const handleClose = vi.fn();
    const tA = vi.fn(() => "Failed to load task options");
    const tB = vi.fn(() => "Failed to load task options");

    function Probe({
      isError,
      t,
    }: {
      isError: boolean;
      t: (key: "loadCreateTask") => string;
    }) {
      useNewTaskWizardLoadError(isError, handleClose, t);
      return null;
    }

    const { rerender, unmount } = render(<Probe isError={false} t={tA} />);
    expect(toastErrorMock).not.toHaveBeenCalled();
    expect(handleClose).not.toHaveBeenCalled();

    rerender(<Probe isError={true} t={tA} />);
    expect(tA).toHaveBeenCalledWith("loadCreateTask");
    expect(toastErrorMock).toHaveBeenCalledWith("Failed to load task options");
    expect(handleClose).toHaveBeenCalledTimes(1);

    // Distinct translator identity returning the same string re-runs the effect per main's deps.
    rerender(<Probe isError={true} t={tB} />);
    expect(tB).toHaveBeenCalledWith("loadCreateTask");
    expect(handleClose).toHaveBeenCalledTimes(2);

    unmount();
  });
});
