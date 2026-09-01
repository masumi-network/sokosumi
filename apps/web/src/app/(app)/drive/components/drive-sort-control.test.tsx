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
  it("renders one control with direction before the key and Date when unset", () => {
    render(
      <DriveSortControl value={null} onChange={vi.fn()} labels={labels} />,
    );

    const control = screen.getByTestId("files-sort-control");
    const trigger = within(control).getByTestId("files-sort-trigger");
    const order = within(trigger).getByTestId("files-sort-order");

    expect(trigger).toHaveTextContent("Date");
    expect(
      trigger.compareDocumentPosition(order) &
        Node.DOCUMENT_POSITION_CONTAINED_BY,
    ).toBeTruthy();
    expect(
      order.compareDocumentPosition(trigger.querySelector("span")!) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.queryByTestId("files-sort-default")).not.toBeInTheDocument();
  });

  it("opens a Sort by menu with Name, Date, and Type only", async () => {
    const user = userEvent.setup();
    render(
      <DriveSortControl value={null} onChange={vi.fn()} labels={labels} />,
    );

    await user.click(screen.getByTestId("files-sort-trigger"));

    expect(screen.getByText("Sort by")).toBeInTheDocument();
    expect(screen.getByTestId("files-sort-name")).toHaveTextContent("Name");
    expect(screen.getByTestId("files-sort-date")).toHaveTextContent("Date");
    expect(screen.getByTestId("files-sort-type")).toHaveTextContent("Type");
    expect(screen.queryByTestId("files-sort-default")).not.toBeInTheDocument();
  });

  it("marks the active sort key with a check in the menu", async () => {
    const user = userEvent.setup();
    render(
      <DriveSortControl
        value={{ sortBy: "type", sortOrder: "asc" }}
        onChange={vi.fn()}
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
    expect(screen.getByTestId("files-sort-date")).toHaveAttribute(
      "aria-checked",
      "false",
    );
  });

  it("checks Date when sort selection is unset", async () => {
    const user = userEvent.setup();
    render(
      <DriveSortControl value={null} onChange={vi.fn()} labels={labels} />,
    );

    await user.click(screen.getByTestId("files-sort-trigger"));

    expect(screen.getByTestId("files-sort-date")).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.getByTestId("files-sort-name")).toHaveAttribute(
      "aria-checked",
      "false",
    );
  });

  it("selecting Name commits name/asc and selecting Date clears to omit", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { rerender } = render(
      <DriveSortControl value={null} onChange={onChange} labels={labels} />,
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
