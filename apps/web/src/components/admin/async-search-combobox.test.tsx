import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/config/env.public", () => ({
  getEnvPublicConfig: () => ({ NEXT_PUBLIC_KEYBOARD_INPUT_DEBOUNCE_TIME: 0 }),
}));

import {
  AsyncSearchCombobox,
  type AsyncSearchComboboxLabels,
} from "./async-search-combobox";

interface Item {
  id: string;
  label: string;
}

const labels: AsyncSearchComboboxLabels = {
  placeholder: "Select an item",
  searchPlaceholder: "Search items…",
  loading: "Searching…",
  empty: "No items found.",
  error: "Search failed. Try again.",
  idle: "Type to search.",
  clear: "Clear",
};

function renderCombobox(
  overrides: Partial<React.ComponentProps<typeof AsyncSearchCombobox<Item>>>,
) {
  const onChange = vi.fn();
  const props = {
    value: null,
    onChange,
    search: vi.fn(async () => []),
    getKey: (item: Item) => item.id,
    getTriggerLabel: (item: Item) => item.label,
    renderOption: (item: Item) => <span>{item.label}</span>,
    labels,
    ...overrides,
  } satisfies React.ComponentProps<typeof AsyncSearchCombobox<Item>>;
  render(<AsyncSearchCombobox<Item> {...props} />);
  return { onChange, props };
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("AsyncSearchCombobox", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows the placeholder when nothing is selected", () => {
    renderCombobox({});
    expect(screen.getByRole("combobox")).toHaveTextContent("Select an item");
  });

  it("shows the selected option label on the trigger", () => {
    renderCombobox({ value: { id: "1", label: "Chosen" } });
    expect(screen.getByRole("combobox")).toHaveTextContent("Chosen");
  });

  it("searches on input and selects a result", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const search = vi.fn(async () => [{ id: "1", label: "Result One" }]);
    const { onChange } = renderCombobox({ search });

    await user.click(screen.getByRole("combobox"));
    await user.type(screen.getByPlaceholderText("Search items…"), "res");

    const option = await screen.findByText("Result One");
    expect(search).toHaveBeenCalledWith("res");
    await user.click(option);
    expect(onChange).toHaveBeenCalledWith({ id: "1", label: "Result One" });
  });

  it("renders the error label when the search rejects", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const search = vi.fn(async () => {
      throw new Error("boom");
    });
    renderCombobox({ search });

    await user.click(screen.getByRole("combobox"));
    await user.type(screen.getByPlaceholderText("Search items…"), "x");

    expect(await screen.findByText("Search failed. Try again.")).toBeVisible();
  });

  it("discards a slower earlier response in favor of the latest query", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const deferreds = new Map<
      string,
      ReturnType<typeof createDeferred<Item[]>>
    >();
    const search = vi.fn((query: string) => {
      const deferred = createDeferred<Item[]>();
      deferreds.set(query, deferred);
      return deferred.promise;
    });
    renderCombobox({ search });

    await user.click(screen.getByRole("combobox"));
    const input = screen.getByPlaceholderText("Search items…");

    await user.type(input, "a");
    await waitFor(() => expect(search).toHaveBeenCalledWith("a"));
    await user.type(input, "b");
    await waitFor(() => expect(search).toHaveBeenCalledWith("ab"));

    // Resolve the newer query first, then the stale earlier one.
    await act(async () => {
      deferreds.get("ab")?.resolve([{ id: "B", label: "Item B" }]);
    });
    await screen.findByText("Item B");
    await act(async () => {
      deferreds.get("a")?.resolve([{ id: "A", label: "Item A" }]);
    });

    expect(screen.queryByText("Item A")).toBeNull();
    expect(screen.getByText("Item B")).toBeInTheDocument();
  });

  it("discards an in-flight response when the popover is closed", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const deferred = createDeferred<Item[]>();
    const search = vi.fn(() => deferred.promise);
    renderCombobox({ search });

    await user.click(screen.getByRole("combobox"));
    await user.type(screen.getByPlaceholderText("Search items…"), "ab");
    await waitFor(() => expect(search).toHaveBeenCalled());

    // Close the popover, then let the in-flight request resolve.
    await user.keyboard("{Escape}");
    await act(async () => {
      deferred.resolve([{ id: "A", label: "Item A" }]);
    });

    // Reopening shows the idle prompt, not the stale result.
    await user.click(screen.getByRole("combobox"));
    expect(screen.queryByText("Item A")).toBeNull();
    expect(screen.getByText("Type to search.")).toBeInTheDocument();
  });

  it("clears the selection from the inline control without opening the menu", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const { onChange } = renderCombobox({
      allowClear: true,
      value: { id: "1", label: "Chosen" },
    });

    await user.click(screen.getByRole("button", { name: "Clear" }));

    expect(onChange).toHaveBeenCalledWith(null);
    expect(screen.queryByPlaceholderText("Search items…")).toBeNull();
  });
});
