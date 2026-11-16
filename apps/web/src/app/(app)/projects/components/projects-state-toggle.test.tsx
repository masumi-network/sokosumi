import { fireEvent, render, screen } from "@testing-library/react";
import { startTransition } from "react";
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

const labels = {
  label: "Show projects",
  open: "Open",
  hidden: "Hidden",
  closed: "Closed",
};

describe("ProjectsStateToggle", () => {
  beforeEach(() => {
    setStateMock.mockClear();
    stateRef.current = "open";
  });

  it("marks the Open view as the selected one by default", () => {
    render(
      <ProjectsStateToggle labels={labels} startTransition={startTransition} />,
    );

    expect(screen.getByRole("radio", { name: "Open" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Closed" })).not.toBeChecked();
  });

  it("offers Open, Hidden and Closed, in that order", () => {
    render(
      <ProjectsStateToggle labels={labels} startTransition={startTransition} />,
    );

    expect(
      screen.getAllByRole("radio").map((segment) => segment.textContent),
    ).toEqual(["Open", "Hidden", "Closed"]);
  });

  it("writes the Hidden view to the URL", () => {
    render(
      <ProjectsStateToggle labels={labels} startTransition={startTransition} />,
    );

    fireEvent.click(screen.getByRole("radio", { name: "Hidden" }));

    expect(setStateMock).toHaveBeenCalledWith("hidden");
  });

  it("writes the chosen view to the URL", () => {
    render(
      <ProjectsStateToggle labels={labels} startTransition={startTransition} />,
    );

    fireEvent.click(screen.getByRole("radio", { name: "Closed" }));

    expect(setStateMock).toHaveBeenCalledWith("closed");
  });

  it("keeps the view when its own segment is clicked again", () => {
    stateRef.current = "closed";
    render(
      <ProjectsStateToggle labels={labels} startTransition={startTransition} />,
    );

    fireEvent.click(screen.getByRole("radio", { name: "Closed" }));

    expect(setStateMock).not.toHaveBeenCalled();
  });

  it("spins in the chosen segment while its list loads", () => {
    stateRef.current = "closed";
    render(
      <ProjectsStateToggle
        labels={labels}
        startTransition={startTransition}
        pending
      />,
    );

    expect(screen.getByRole("radio", { name: "Closed" })).toContainElement(
      screen.getByTestId("projects-state-pending"),
    );
    expect(screen.getAllByTestId("projects-state-pending")).toHaveLength(1);
  });

  it("shows no spinner once the list has loaded", () => {
    render(
      <ProjectsStateToggle labels={labels} startTransition={startTransition} />,
    );

    expect(
      screen.queryByTestId("projects-state-pending"),
    ).not.toBeInTheDocument();
  });
});
