import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import TaskNotFound from "./not-found";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

describe("TaskNotFound", () => {
  it("keeps the boundary synchronous (async breaks PPR resume, SOK-1080)", () => {
    expect(TaskNotFound.constructor.name).toBe("Function");
  });

  it("points to archived tasks and back to the board", () => {
    render(<TaskNotFound />);

    expect(screen.getByRole("heading", { name: "title" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "archived" })).toHaveAttribute(
      "href",
      "/tasks/archived",
    );
    expect(screen.getByRole("link", { name: "back" })).toHaveAttribute(
      "href",
      "/tasks",
    );
  });
});
