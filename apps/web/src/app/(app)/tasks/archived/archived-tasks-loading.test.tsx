import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

let searchParams = new URLSearchParams();

vi.mock("next/navigation", () => ({
  useSearchParams: () => searchParams,
}));
vi.mock("next/form", () => ({
  default: ({ children, ...props }: React.ComponentProps<"form">) => (
    <form {...props}>{children}</form>
  ),
}));
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));
vi.mock("@/app/tasks/components/back-to-tasks-button", () => ({
  BackToTasksButton: ({ label }: { label: string }) => (
    <a href="/tasks">{label}</a>
  ),
}));

import {
  ArchivedTaskLoading,
  ArchivedTasksLoading,
} from "./archived-tasks-loading";

afterEach(() => {
  searchParams = new URLSearchParams();
});

describe("ArchivedTasksLoading", () => {
  it("draws the heading and search right away, with the search from the URL", () => {
    searchParams = new URLSearchParams("q=spring");
    const { container } = render(<ArchivedTasksLoading />);

    expect(container.querySelector("h1")).toHaveTextContent("title");
    expect(container.querySelector('input[type="search"]')).toHaveValue(
      "spring",
    );
  });

  it("keeps only the search inert; heading and back link stay readable", () => {
    const { container } = render(<ArchivedTasksLoading />);

    expect(
      container.querySelector('input[type="search"]')?.closest("[inert]"),
    ).not.toBeNull();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "title",
    );
    expect(screen.getByRole("link", { name: "back" })).toBeInTheDocument();
  });

  it("says the list is loading in the list's status line, in its place", () => {
    render(<ArchivedTasksLoading />);

    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("loading");
    // In flow like the list's own line, so the rows below do not move.
    expect(status).toHaveClass("-mt-2");
    expect(status).not.toHaveClass("sr-only");
  });

  it("draws row placeholders in the list's frame", () => {
    const { container } = render(<ArchivedTasksLoading />);

    const rows = container.querySelectorAll("ul > li");
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]).toHaveClass(
      "flex",
      "items-center",
      "gap-3",
      "px-3",
      "py-2",
    );
    expect(screen.getByText("draftNote")).toBeInTheDocument();
  });
});

describe("ArchivedTaskLoading", () => {
  it("draws the way back to Archived right away and says it is loading", () => {
    render(<ArchivedTaskLoading />);

    expect(screen.getByRole("status")).toHaveTextContent("loadingTask");

    expect(screen.getByRole("link", { name: "title" })).toHaveAttribute(
      "href",
      "/tasks/archived",
    );
  });
});
