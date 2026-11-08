import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { CommandDialog } from "@/components/ui/command";

describe("CommandDialog", () => {
  it("renders no heading while closed", () => {
    render(<CommandDialog open={false} title="Search" description="Find" />);

    expect(screen.queryByRole("heading", { name: "Search" })).toBeNull();
    expect(screen.queryByText("Find")).toBeNull();
  });

  it("names the open dialog with its title", () => {
    render(<CommandDialog open title="Search" description="Find" />);

    expect(screen.getByRole("dialog", { name: "Search" })).toBeInTheDocument();
  });
});
