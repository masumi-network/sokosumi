import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ProjectsFilter } from "@/app/projects/components/projects-filter";

const { setQueryStateMock, queryStateRef } = vi.hoisted(() => ({
  setQueryStateMock: vi.fn(),
  queryStateRef: { current: "" },
}));

vi.mock("nuqs", () => ({
  useQueryState: (_key: string, _options?: unknown) => [
    queryStateRef.current,
    setQueryStateMock,
  ],
}));

// The real hook debounces against an env-configured delay; the component's
// contract is "typing updates the param", not the delay itself.
vi.mock("use-debounce", () => ({
  useDebouncedCallback: (fn: (value: string) => void) =>
    Object.assign(fn, { cancel: vi.fn() }),
}));

const labels = { placeholder: "Filter projects", clear: "Clear filter" };

describe("ProjectsFilter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryStateRef.current = "";
  });

  it("writes what the user types to the q search param", async () => {
    render(<ProjectsFilter labels={labels} />);

    await userEvent.type(screen.getByPlaceholderText("Filter projects"), "aut");

    expect(setQueryStateMock).toHaveBeenLastCalledWith("aut");
  });

  it("offers no clear button until something is typed", () => {
    render(<ProjectsFilter labels={labels} />);

    expect(
      screen.queryByRole("button", { name: "Clear filter" }),
    ).not.toBeInTheDocument();
  });

  it("clears the param when the clear button is used", async () => {
    queryStateRef.current = "autumn";
    render(<ProjectsFilter labels={labels} />);

    await userEvent.click(screen.getByRole("button", { name: "Clear filter" }));

    expect(setQueryStateMock).toHaveBeenLastCalledWith("");
  });

  it("clears the param on Escape", async () => {
    queryStateRef.current = "autumn";
    render(<ProjectsFilter labels={labels} />);

    await userEvent.type(
      screen.getByPlaceholderText("Filter projects"),
      "{Escape}",
    );

    expect(setQueryStateMock).toHaveBeenLastCalledWith("");
  });
});
