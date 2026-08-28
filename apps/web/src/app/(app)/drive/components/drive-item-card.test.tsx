import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { DriveItemCard } from "@/app/drive/components/drive-item-card";
import { driveItemActionsClass } from "@/app/drive/components/drive-view-layout";

describe("DriveItemCard actions positioning", () => {
  it("keeps grid overflow actions absolutely positioned (not relative)", () => {
    expect(driveItemActionsClass("grid")).toContain("absolute");
    expect(driveItemActionsClass("grid")).toContain("top-2");
    expect(driveItemActionsClass("grid")).toContain("right-2");

    render(
      <DriveItemCard
        viewMode="grid"
        actions={<button type="button">more</button>}
      >
        <span>file.docx</span>
      </DriveItemCard>,
    );

    const actions = screen.getByRole("button", { name: "more" }).parentElement;
    expect(actions).not.toBeNull();
    expect(actions?.className).toContain("absolute");
    expect(actions?.className).toContain("top-2");
    expect(actions?.className).toContain("right-2");
    expect(actions?.className).not.toContain("relative");
  });

  it("keeps list actions in document flow", () => {
    render(
      <DriveItemCard
        viewMode="list"
        actions={<button type="button">more</button>}
      >
        <span>file.docx</span>
      </DriveItemCard>,
    );

    const actions = screen.getByRole("button", { name: "more" }).parentElement;
    expect(actions?.className).not.toContain("absolute");
  });
});
