import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { TasksPageSkeletonHost } from "@/app/tasks/components/tasks-page-skeleton-host";
import { TASK_CARD_DENSITY_CLASS } from "@/app/tasks/constants";

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
});
