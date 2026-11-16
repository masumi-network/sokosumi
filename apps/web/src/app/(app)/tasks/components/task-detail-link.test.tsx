import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TaskDetailLink } from "@/app/tasks/components/task-detail-link";
import { TASKS_RETURN_PATH_SESSION_KEY } from "@/app/tasks/components/task-navigation";
import { INTENT_DWELL_MS } from "@/components/resting-intent-link";
import { approachElement } from "@/test/approach-element";

const routerPrefetchMock = vi.fn();
// The task's content, not only the route's shared App Shell (kind "auto").
const CONTENT_PREFETCH = { kind: "full" };

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    prefetch: routerPrefetchMock,
  }),
}));

describe("TaskDetailLink", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Fake timers for the dwell; a real focus() so :focus-visible matches, as it
  // does for keyboard focus. A focus event alone stands for a click's focus.
  function renderLink(href = "/tasks/task-1", prefetchContent?: boolean) {
    render(
      <TaskDetailLink href={href} prefetchContent={prefetchContent}>
        Open task
      </TaskDetailLink>,
    );
    return screen.getByRole("link", { name: "Open task" });
  }

  beforeEach(() => {
    vi.useFakeTimers();
    return () => {
      vi.useRealTimers();
    };
  });

  it("prefetches the task detail content on a resting hover", () => {
    const link = renderLink();

    fireEvent.pointerEnter(link, { pointerType: "mouse" });
    vi.advanceTimersByTime(INTENT_DWELL_MS);

    expect(link).toHaveAttribute("href", "/tasks/task-1");
    expect(routerPrefetchMock).toHaveBeenCalledExactlyOnceWith(
      "/tasks/task-1",
      CONTENT_PREFETCH,
    );
  });

  it("prefetches the task detail content on resting keyboard focus", () => {
    const link = renderLink();

    act(() => link.focus());
    vi.advanceTimersByTime(INTENT_DWELL_MS);

    expect(routerPrefetchMock).toHaveBeenCalledExactlyOnceWith(
      "/tasks/task-1",
      CONTENT_PREFETCH,
    );
  });

  // Tabbing through a list must not render every task it passes.
  it("does not load the content for focus that moves on", () => {
    const link = renderLink();

    act(() => link.focus());
    act(() => link.blur());
    vi.advanceTimersByTime(INTENT_DWELL_MS);

    expect(routerPrefetchMock).not.toHaveBeenCalled();
  });

  // A pointer crossing a list on its way elsewhere must not start a server
  // render for every row it passes.
  it("does not load the content for a pointer that only passes over", () => {
    const link = renderLink();

    fireEvent.pointerEnter(link, { pointerType: "mouse" });
    vi.advanceTimersByTime(INTENT_DWELL_MS - 1);
    fireEvent.pointerLeave(link);
    vi.advanceTimersByTime(INTENT_DWELL_MS);

    expect(routerPrefetchMock).not.toHaveBeenCalled();
  });

  // A finger enters each row it rests on while it scrolls, and a tap focuses
  // the link after pointerup, so touch loads only the shell.
  it("prefetches only the shell for a tap", () => {
    const link = renderLink();

    fireEvent.pointerEnter(link, { pointerType: "touch" });
    fireEvent.pointerDown(link, { pointerType: "touch" });
    fireEvent.touchStart(link);
    fireEvent.pointerUp(link, { pointerType: "touch" });
    fireEvent.focus(link);
    fireEvent.click(link);
    vi.advanceTimersByTime(INTENT_DWELL_MS);

    expect(routerPrefetchMock).toHaveBeenCalledExactlyOnceWith("/tasks/task-1");
  });

  // The click already loads the page, so neither the dwell nor the focus the
  // press causes may render it a second time.
  it("does not load the content for a click inside the dwell", () => {
    const link = renderLink();

    fireEvent.pointerEnter(link, { pointerType: "mouse" });
    fireEvent.pointerDown(link, { pointerType: "mouse" });
    fireEvent.focus(link);
    fireEvent.pointerUp(link, { pointerType: "mouse" });
    fireEvent.click(link);
    vi.advanceTimersByTime(INTENT_DWELL_MS);

    expect(routerPrefetchMock).not.toHaveBeenCalled();
  });

  // A press released off the link leaves it focused with no click. That
  // focus came from the pointer, so it is not reading intent.
  it("does not load the content for focus from a press that never clicks", () => {
    const link = renderLink();

    fireEvent.pointerDown(link, { pointerType: "mouse" });
    fireEvent.focus(link);
    vi.advanceTimersByTime(INTENT_DWELL_MS);

    expect(routerPrefetchMock).not.toHaveBeenCalled();
  });

  // A drag or text selection crosses rows with a button held.
  it("does not load the content for a pointer that crosses with a button held", () => {
    const link = renderLink();

    fireEvent.pointerEnter(link, { pointerType: "mouse", buttons: 1 });
    vi.advanceTimersByTime(INTENT_DWELL_MS);

    expect(routerPrefetchMock).not.toHaveBeenCalled();
  });

  // A middle click fires auxclick, not click, so the press must cancel alone.
  it("cancels the hover dwell on a press", () => {
    const link = renderLink();

    fireEvent.pointerEnter(link, { pointerType: "mouse" });
    fireEvent.pointerDown(link, { pointerType: "mouse", button: 1 });
    vi.advanceTimersByTime(INTENT_DWELL_MS);

    expect(routerPrefetchMock).not.toHaveBeenCalled();
  });

  // A filter or navigation can remove a row inside the dwell.
  it("drops the dwell when the link unmounts", () => {
    const { unmount } = render(
      <TaskDetailLink href="/tasks/task-1">Open task</TaskDetailLink>,
    );

    fireEvent.pointerEnter(screen.getByRole("link", { name: "Open task" }), {
      pointerType: "mouse",
    });
    unmount();
    vi.advanceTimersByTime(INTENT_DWELL_MS);

    expect(routerPrefetchMock).not.toHaveBeenCalled();
  });

  // A keyboard or assistive click comes with no press.
  it("cancels the hover dwell on a click", () => {
    const link = renderLink();

    fireEvent.pointerEnter(link, { pointerType: "mouse" });
    fireEvent.click(link);
    vi.advanceTimersByTime(INTENT_DWELL_MS);

    expect(routerPrefetchMock).not.toHaveBeenCalled();
  });

  // A mouse crossing a focused link must not cancel the focus dwell.
  it("keeps the focus dwell when a pointer passes over", () => {
    const link = renderLink();

    act(() => link.focus());
    fireEvent.pointerEnter(link, { pointerType: "mouse" });
    fireEvent.pointerLeave(link, { pointerType: "mouse" });
    vi.advanceTimersByTime(INTENT_DWELL_MS);

    expect(routerPrefetchMock).toHaveBeenCalledExactlyOnceWith(
      "/tasks/task-1",
      CONTENT_PREFETCH,
    );
  });

  // A page whose reads are not cached prefetches only its skeleton, so a
  // content prefetch would be a server render for nothing.
  it("prefetches only the shell when content prefetch is off", () => {
    const link = renderLink("/admin/tasks/task-1", false);

    act(() => link.focus());
    vi.advanceTimersByTime(INTENT_DWELL_MS);

    expect(routerPrefetchMock).toHaveBeenCalledExactlyOnceWith(
      "/admin/tasks/task-1",
    );
  });

  // A predicted approach is weaker intent than a hover, so it prefetches only
  // the shell and never pays for a content render.
  it("prefetches only the shell when the reader heads for the link", async () => {
    render(<TaskDetailLink href="/tasks/task-1">Open task</TaskDetailLink>);

    await act(() =>
      approachElement(screen.getByRole("link", { name: "Open task" })),
    );

    expect(routerPrefetchMock).toHaveBeenCalledExactlyOnceWith("/tasks/task-1");
  });

  it("stores the current tasks URL when navigating from the tasks root", () => {
    window.history.replaceState({}, "", "/tasks?view=list");

    render(<TaskDetailLink href="/tasks/task-1">Open task</TaskDetailLink>);

    fireEvent.click(screen.getByRole("link", { name: "Open task" }));

    expect(window.sessionStorage.getItem(TASKS_RETURN_PATH_SESSION_KEY)).toBe(
      "/tasks?view=list",
    );
  });
});
