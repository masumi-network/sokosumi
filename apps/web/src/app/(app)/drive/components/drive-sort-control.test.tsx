import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { DriveSortControl } from "@/app/drive/components/drive-sort-control";

const labels = {
  sort: "Sort by",
  name: "Name",
  date: "Date",
  type: "Type",
  ascending: "Ascending",
  descending: "Descending",
};

describe("DriveSortControl", () => {
  it("Browse omit default shows Name with direction before the key", () => {
    render(
      <DriveSortControl
        value={null}
        onChange={vi.fn()}
        surface="browse"
        labels={labels}
      />,
    );

    const control = screen.getByTestId("files-sort-control");
    const trigger = within(control).getByTestId("files-sort-trigger");
    const order = within(trigger).getByTestId("files-sort-order");

    expect(trigger).toHaveTextContent("Name");
    expect(
      trigger.compareDocumentPosition(order) &
        Node.DOCUMENT_POSITION_CONTAINED_BY,
    ).toBeTruthy();
    expect(
      order.compareDocumentPosition(trigger.querySelector("span")!) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("Tasks omit default shows Date", () => {
    render(
      <DriveSortControl
        value={null}
        onChange={vi.fn()}
        surface="tasks"
        labels={labels}
      />,
    );

    expect(screen.getByTestId("files-sort-trigger")).toHaveTextContent("Date");
  });

  it("opens a Sort by menu with Name, Date, and Type only", async () => {
    const user = userEvent.setup();
    render(
      <DriveSortControl
        value={null}
        onChange={vi.fn()}
        surface="browse"
        labels={labels}
      />,
    );

    await user.click(screen.getByTestId("files-sort-trigger"));

    expect(screen.getByText("Sort by")).toBeInTheDocument();
    expect(screen.getByTestId("files-sort-name")).toHaveTextContent("Name");
    expect(screen.getByTestId("files-sort-date")).toHaveTextContent("Date");
    expect(screen.getByTestId("files-sort-type")).toHaveTextContent("Type");
  });

  it("marks the active sort key with a check in the menu", async () => {
    const user = userEvent.setup();
    render(
      <DriveSortControl
        value={{ sortBy: "type", sortOrder: "asc" }}
        onChange={vi.fn()}
        surface="browse"
        labels={labels}
      />,
    );

    await user.click(screen.getByTestId("files-sort-trigger"));

    expect(screen.getByTestId("files-sort-type")).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.getByTestId("files-sort-name")).toHaveAttribute(
      "aria-checked",
      "false",
    );
  });

  it("Browse checks Name when sort selection is unset", async () => {
    const user = userEvent.setup();
    render(
      <DriveSortControl
        value={null}
        onChange={vi.fn()}
        surface="browse"
        labels={labels}
      />,
    );

    await user.click(screen.getByTestId("files-sort-trigger"));

    expect(screen.getByTestId("files-sort-name")).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.getByTestId("files-sort-date")).toHaveAttribute(
      "aria-checked",
      "false",
    );
  });

  it("Browse selecting Date commits date/desc; selecting Name clears to omit", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { rerender } = render(
      <DriveSortControl
        value={null}
        onChange={onChange}
        surface="browse"
        labels={labels}
      />,
    );

    await user.click(screen.getByTestId("files-sort-trigger"));
    await user.click(screen.getByTestId("files-sort-date"));
    expect(onChange).toHaveBeenLastCalledWith({
      sortBy: "date",
      sortOrder: "desc",
    });

    rerender(
      <DriveSortControl
        value={{ sortBy: "date", sortOrder: "desc" }}
        onChange={onChange}
        surface="browse"
        labels={labels}
      />,
    );

    await user.click(screen.getByTestId("files-sort-trigger"));
    await user.click(screen.getByTestId("files-sort-name"));
    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  it("Tasks selecting Name commits name/asc; selecting Date clears to omit", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { rerender } = render(
      <DriveSortControl
        value={null}
        onChange={onChange}
        surface="tasks"
        labels={labels}
      />,
    );

    await user.click(screen.getByTestId("files-sort-trigger"));
    await user.click(screen.getByTestId("files-sort-name"));
    expect(onChange).toHaveBeenLastCalledWith({
      sortBy: "name",
      sortOrder: "asc",
    });

    rerender(
      <DriveSortControl
        value={{ sortBy: "name", sortOrder: "asc" }}
        onChange={onChange}
        surface="tasks"
        labels={labels}
      />,
    );

    await user.click(screen.getByTestId("files-sort-trigger"));
    await user.click(screen.getByTestId("files-sort-date"));
    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  it("selecting the active key toggles direction", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <DriveSortControl
        value={{ sortBy: "name", sortOrder: "asc" }}
        onChange={onChange}
        surface="tasks"
        labels={labels}
      />,
    );

    await user.click(screen.getByTestId("files-sort-trigger"));
    await user.click(screen.getByTestId("files-sort-name"));
    expect(onChange).toHaveBeenLastCalledWith({
      sortBy: "name",
      sortOrder: "desc",
    });
  });
});
