import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import {
  childFolders,
  DriveFolderNav,
} from "@/app/drive/components/drive-folder-nav";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

const FOLDERS = ["Reports", "Reports/2026", "Reports/2026/Q3", "Brand"];

describe("childFolders", () => {
  it("lists the folders directly inside the root", () => {
    expect(childFolders(FOLDERS, "")).toEqual(["Brand", "Reports"]);
  });

  it("lists one level down, even when only a deeper path is known", () => {
    expect(childFolders(["Reports/2026/Q3"], "Reports")).toEqual([
      "Reports/2026",
    ]);
    expect(childFolders(FOLDERS, "Reports")).toEqual(["Reports/2026"]);
  });

  it("does not mistake a folder sharing a name prefix for a child", () => {
    expect(childFolders(["Reports 2025/Q1"], "Reports")).toEqual([]);
  });
});

describe("DriveFolderNav", () => {
  it("steps into a folder and back out through the trail", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <DriveFolderNav
        folders={FOLDERS}
        current="Reports/2026"
        onSelect={onSelect}
      />,
    );

    const trail = screen.getByRole("navigation", { name: "foldersLabel" });
    await user.click(within(trail).getByRole("button", { name: "Reports" }));
    expect(onSelect).toHaveBeenLastCalledWith("Reports");

    await user.click(
      within(trail).getByRole("button", { name: "foldersRoot" }),
    );
    expect(onSelect).toHaveBeenLastCalledWith("");

    // The folder the reader is in is where they are, not a place to go.
    expect(within(trail).getByRole("button", { name: "2026" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Q3" }));
    expect(onSelect).toHaveBeenLastCalledWith("Reports/2026/Q3");
  });

  it("shows the current folder's actions and renders nothing with no folders", () => {
    const { container, rerender } = render(
      <DriveFolderNav
        folders={[]}
        current=""
        onSelect={() => undefined}
        actions={<button type="button">rename</button>}
      />,
    );
    expect(container).toBeEmptyDOMElement();

    rerender(
      <DriveFolderNav
        folders={FOLDERS}
        current="Brand"
        onSelect={() => undefined}
        actions={<button type="button">rename</button>}
      />,
    );
    expect(screen.getByRole("button", { name: "rename" })).toBeVisible();
  });
});

describe("DriveFolderNav virtual folder", () => {
  it("lists the virtual folder with the root folders, sorted, and opens it", async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    render(
      <DriveFolderNav
        folders={FOLDERS}
        current=""
        onSelect={vi.fn()}
        virtualFolder={{ label: "Sokosumi Projects", onOpen }}
      />,
    );
    const names = within(screen.getByTestId("drive-folder-children"))
      .getAllByRole("button")
      .map((b) => b.textContent);
    expect(names).toEqual(["Brand", "Reports", "Sokosumi Projects"]);
    await user.click(screen.getByRole("button", { name: "Sokosumi Projects" }));
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it("shows it even with no real folders, but not inside a folder", () => {
    const virtualFolder = { label: "Sokosumi Projects", onOpen: vi.fn() };
    const { rerender } = render(
      <DriveFolderNav
        folders={[]}
        current=""
        onSelect={vi.fn()}
        virtualFolder={virtualFolder}
      />,
    );
    expect(screen.getByText("Sokosumi Projects")).toBeInTheDocument();
    rerender(
      <DriveFolderNav
        folders={FOLDERS}
        current="Reports"
        onSelect={vi.fn()}
        virtualFolder={virtualFolder}
      />,
    );
    expect(screen.queryByText("Sokosumi Projects")).toBeNull();
  });
});
