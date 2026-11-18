import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { TaskTitleHeading } from "./task-title-heading";

// Next announces a route by its title only if the title has changed by the
// time the page commits; a task's title streams in later. Focusing the
// heading makes screen readers read the task name on every open.
describe("TaskTitleHeading", () => {
  it("focuses the task heading when the task opens", () => {
    render(<TaskTitleHeading taskId="task-1" title="Spring menu" />);
    const heading = screen.getByRole("heading", {
      level: 1,
      name: "Spring menu",
    });
    expect(heading).toHaveFocus();
    expect(heading).toHaveAttribute("tabindex", "-1");
  });

  // A keyboard user who opens a task with Enter must still see where focus is.
  it("keeps a visible focus ring for keyboard users", () => {
    render(<TaskTitleHeading taskId="task-1" title="Spring menu" />);
    const heading = screen.getByRole("heading", { level: 1 });
    expect(heading).not.toHaveClass("outline-none");
    expect(heading).toHaveClass(
      "focus-visible:outline-2",
      "focus-visible:outline-ring",
    );
  });

  it("does not take focus back when the same task re-renders", () => {
    const { rerender } = render(
      <>
        <TaskTitleHeading taskId="task-1" title="Spring menu" />
        <button type="button">Status</button>
      </>,
    );
    const status = screen.getByRole("button", { name: "Status" });
    status.focus();
    rerender(
      <>
        <TaskTitleHeading taskId="task-1" title="Spring menu, renamed" />
        <button type="button">Status</button>
      </>,
    );
    expect(status).toHaveFocus();
  });

  it("focuses the heading again when another task opens", () => {
    const { rerender } = render(
      <>
        <TaskTitleHeading taskId="task-1" title="Spring menu" />
        <button type="button">Status</button>
      </>,
    );
    screen.getByRole("button", { name: "Status" }).focus();
    rerender(
      <>
        <TaskTitleHeading taskId="task-2" title="Autumn shoot" />
        <button type="button">Status</button>
      </>,
    );
    expect(screen.getByRole("heading", { name: "Autumn shoot" })).toHaveFocus();
  });

  it.each([
    [
      "an open dialog",
      <div role="dialog" aria-label="Link a task" key="d">
        <button type="button">Pick</button>
      </div>,
      "Pick",
    ],
    ["a text field", <input aria-label="Comment" key="i" />, "Comment"],
  ])("leaves focus in %s", (_, other, name) => {
    const { rerender } = render(<>{other}</>);
    const target =
      screen.queryByRole("button", { name }) ??
      screen.getByRole("textbox", { name });
    target.focus();
    rerender(
      <>
        {other}
        <TaskTitleHeading taskId="task-1" title="Spring menu" />
      </>,
    );
    expect(target).toHaveFocus();
  });
});
