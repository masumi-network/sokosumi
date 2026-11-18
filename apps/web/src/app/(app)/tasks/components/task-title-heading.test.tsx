import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

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
      // A gap between ring and text, so the title never reads as a field.
      "focus-visible:outline-offset-2",
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

  // A refresh or a pasted link already starts at the top of the page; moving
  // focus there only draws the ring as a box around the title.
  describe("on a fresh page load of the task", () => {
    afterEach(() => {
      vi.restoreAllMocks();
      vi.resetModules();
    });

    function loadedAt(url: string) {
      vi.spyOn(performance, "getEntriesByType").mockReturnValue([
        { name: url } as PerformanceEntry,
      ]);
    }

    it("leaves focus alone on the page the document loaded at", async () => {
      loadedAt("https://app.test/tasks/task-1");
      vi.resetModules();
      const { TaskTitleHeading: Heading } = await import(
        "./task-title-heading"
      );
      render(<Heading taskId="task-1" title="Spring menu" />);
      expect(screen.getByRole("heading", { level: 1 })).not.toHaveFocus();
    });

    it("still focuses the heading of the next task opened in the app", async () => {
      loadedAt("https://app.test/tasks/task-1");
      vi.resetModules();
      const { TaskTitleHeading: Heading } = await import(
        "./task-title-heading"
      );
      const { rerender } = render(
        <Heading taskId="task-1" title="Spring menu" />,
      );
      rerender(<Heading taskId="task-2" title="Autumn shoot" />);
      expect(
        screen.getByRole("heading", { name: "Autumn shoot" }),
      ).toHaveFocus();
    });

    it("focuses the heading when the document loaded at the board or Edit", async () => {
      loadedAt("https://app.test/tasks/task-1/edit");
      vi.resetModules();
      const { TaskTitleHeading: Heading } = await import(
        "./task-title-heading"
      );
      render(<Heading taskId="task-1" title="Spring menu" />);
      expect(screen.getByRole("heading", { level: 1 })).toHaveFocus();
    });
  });
});
