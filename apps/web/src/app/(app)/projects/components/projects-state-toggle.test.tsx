import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectsStateToggle } from "@/app/projects/components/projects-state-toggle";

const { setStateMock, stateRef } = vi.hoisted(() => ({
  setStateMock: vi.fn(),
  stateRef: { current: "open" },
}));

vi.mock("nuqs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("nuqs")>()),
  useQueryState: () => [stateRef.current, setStateMock],
}));

const labels = { label: "Show projects", open: "Open", closed: "Closed" };

describe("ProjectsStateToggle", () => {
  beforeEach(() => {
    setStateMock.mockClear();
    stateRef.current = "open";
  });

  it("marks the Open view as the selected one by default", () => {
    render(<ProjectsStateToggle labels={labels} />);

    expect(screen.getByRole("radio", { name: "Open" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Closed" })).not.toBeChecked();
  });

  it("writes the chosen view to the URL", () => {
    render(<ProjectsStateToggle labels={labels} />);

    fireEvent.click(screen.getByRole("radio", { name: "Closed" }));

    expect(setStateMock).toHaveBeenCalledWith("closed");
  });

  it("keeps the view when its own segment is clicked again", () => {
    stateRef.current = "closed";
    render(<ProjectsStateToggle labels={labels} />);

    fireEvent.click(screen.getByRole("radio", { name: "Closed" }));

    expect(setStateMock).not.toHaveBeenCalled();
  });
});
