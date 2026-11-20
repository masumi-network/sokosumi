import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TasksPageSkeletonHost } from "@/app/tasks/components/tasks-page-skeleton-host";
import { TASK_CARD_DENSITY_CLASS } from "@/app/tasks/constants";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

const COOKIES = ["tasks_view_mode", "tasks_density"];

afterEach(() => {
  for (const name of COOKIES) {
    document.cookie = `${name}=; max-age=0; path=/`;
  }
});

describe("TasksPageSkeletonHost", () => {
  it("draws compact card placeholders when the density cookie says compact", () => {
    document.cookie = "tasks_view_mode=board; path=/";
    document.cookie = "tasks_density=compact; path=/";

    render(<TasksPageSkeletonHost />);

    for (const card of screen.getAllByTestId("task-card-skeleton")) {
      expect(card.className).toContain(TASK_CARD_DENSITY_CLASS.compact);
    }
  });

  it("reserves the toolbar height the board last drew at this width", () => {
    sessionStorage.setItem(
      "tasks-toolbar-height",
      JSON.stringify({ width: window.innerWidth, height: 96 }),
    );

    const { container } = render(<TasksPageSkeletonHost />);

    expect(
      container.querySelector("[data-tasks-toolbar-row]")?.parentElement,
    ).toHaveStyle({ minHeight: "96px" });
  });
});
