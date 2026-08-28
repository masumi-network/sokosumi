import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { DriveItemCard } from "@/app/drive/components/drive-item-card";
import {
  driveItemActionsClass,
  driveItemBodyClass,
} from "@/app/drive/components/drive-view-layout";

describe("DriveItemCard actions positioning", () => {
  it("keeps grid overflow actions in document flow", () => {
    expect(driveItemActionsClass("grid")).toContain("shrink-0");
    expect(driveItemActionsClass("grid")).not.toContain("absolute");
    expect(driveItemBodyClass("grid")).toContain("items-center");
    expect(driveItemBodyClass("grid")).not.toContain("flex-col");

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
    expect(actions?.className).toContain("shrink-0");
    expect(actions?.className).not.toContain("absolute");
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
