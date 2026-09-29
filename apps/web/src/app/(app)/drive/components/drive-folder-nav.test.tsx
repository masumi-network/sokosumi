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
