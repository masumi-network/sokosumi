import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ProjectsFilter } from "@/app/projects/components/projects-filter";

const { setQueryStateMock, queryStateRef, useQueryStateMock } = vi.hoisted(
  () => ({
    setQueryStateMock: vi.fn(),
    queryStateRef: { current: "" },
    useQueryStateMock: vi.fn((_key: string, _options?: unknown) => [
      queryStateRef.current,
      setQueryStateMock,
    ]),
  }),
);

vi.mock("nuqs", () => ({
  useQueryState: (key: string, options?: unknown) =>
    useQueryStateMock(key, options),
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

    await userEvent.type(screen.getByLabelText("Filter projects"), "aut");

    expect(setQueryStateMock).toHaveBeenLastCalledWith("aut");
  });

  it("refetches in a transition so the field is not replaced by the page skeleton", () => {
    render(<ProjectsFilter labels={labels} />);

    expect(useQueryStateMock).toHaveBeenCalledWith(
      "q",
      expect.objectContaining({
        shallow: false,
        clearOnDefault: true,
        startTransition: expect.any(Function),
      }),
    );
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

    await userEvent.type(screen.getByLabelText("Filter projects"), "{Escape}");

    expect(setQueryStateMock).toHaveBeenLastCalledWith("");
  });
});
