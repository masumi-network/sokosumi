import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ProjectHeaderActions } from "@/app/projects/components/project-header-actions";

vi.mock("next-intl/server", () => ({
  getTranslations: async (namespace: string) => (key: string) =>
    `${namespace}.${key}`,
}));

vi.mock("@/app/projects/components/project-detail-pin-button", () => ({
  ProjectDetailPinButton: ({ isClosed }: { isClosed?: boolean }) => (
    <div data-closed={String(isClosed)} data-testid="pin" />
  ),
}));

vi.mock("@/app/projects/components/project-detail-actions", () => ({
  ProjectDetailActions: ({
    isClosingOrClosed,
    labels,
    projectRevision,
  }: {
    isClosingOrClosed: boolean;
    labels: { moreActions: string };
    projectRevision?: number;
  }) => (
    <div
      data-closed={String(isClosingOrClosed)}
      data-revision={String(projectRevision)}
      data-testid="menu"
    >
      {labels.moreActions}
    </div>
  ),
}));

describe("ProjectHeaderActions", () => {
  it("renders pin and the project menu for an open project", async () => {
    render(await ProjectHeaderActions({ projectId: "p1", projectRevision: 3 }));

    expect(screen.getByTestId("pin")).toHaveAttribute("data-closed", "false");
    expect(screen.getByTestId("menu")).toHaveAttribute("data-closed", "false");
    expect(screen.getByTestId("menu")).toHaveAttribute("data-revision", "3");
    expect(screen.getByTestId("menu")).toHaveTextContent(
      "App.Projects.Detail.actions.moreActions",
    );
  });

  it("treats a closing project as closed for both controls", async () => {
    render(
      await ProjectHeaderActions({
        closingAt: new Date("2026-09-01T00:00:00Z"),
        projectId: "p1",
      }),
    );

    expect(screen.getByTestId("pin")).toHaveAttribute("data-closed", "true");
    expect(screen.getByTestId("menu")).toHaveAttribute("data-closed", "true");
  });

  it("treats a closed project as closed", async () => {
    render(
      await ProjectHeaderActions({
        closedAt: "2026-09-01T00:00:00Z",
        projectId: "p1",
      }),
    );

    expect(screen.getByTestId("pin")).toHaveAttribute("data-closed", "true");
    expect(screen.getByTestId("menu")).toHaveAttribute("data-closed", "true");
  });
});
