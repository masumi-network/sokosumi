import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  DriveItemCard,
  DriveItemName,
  driveItemActivation,
} from "@/app/drive/components/drive-item-card";
import {
  driveItemActionsClass,
  driveItemBodyClass,
} from "@/app/drive/components/drive-view-layout";

describe("DriveItemCard name accessibility", () => {
  it("hides the visible name from AT when the card has an activate control", () => {
    render(
      <DriveItemCard
        viewMode="grid"
        {...driveItemActivation(() => undefined, "report.pdf")}
      >
        <DriveItemName name="report.pdf" />
      </DriveItemCard>,
    );

    expect(
      screen.getByRole("button", { name: "report.pdf" }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "report.pdf" })).toHaveLength(
      1,
    );

    const visibleName = screen.getByText("report.pdf");
    expect(visibleName).toHaveAttribute("aria-hidden", "true");
  });

  it("keeps the visible name accessible when the card is not activatable", () => {
    render(
      <DriveItemCard viewMode="list">
        <DriveItemName name="report.pdf" />
      </DriveItemCard>,
    );

    const visibleName = screen.getByText("report.pdf");
    expect(visibleName).not.toHaveAttribute("aria-hidden", "true");
  });

  it("omits activation props when onActivate is undefined", () => {
    expect(driveItemActivation(undefined, "report.pdf")).toEqual({});
  });
});

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
