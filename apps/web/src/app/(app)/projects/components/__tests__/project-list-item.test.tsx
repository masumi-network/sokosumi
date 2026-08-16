import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ProjectListItem } from "@/app/projects/components/project-list-item";
import type { ProjectListItem as ProjectListItemType } from "@/lib/clients/generated/core/types.gen";

vi.mock("@/lib/actions/project/action", () => ({
  deleteProject: vi.fn(),
}));

const labels = {
  actions: {
    moreActions: "More",
    viewDetails: "View details",
    edit: "Edit",
    delete: "Delete",
  },
  deleteDialog: {
    title: "Delete project",
    description: "This will delete the project.",
    confirm: "Delete",
    cancel: "Cancel",
    error: "Failed",
  },
  counts: {
    tasks: "Tasks",
    jobs: "Jobs",
  },
};

const project = {
  id: "project-1",
  workspaceId: "workspace-1",
  name: "Autumn Launch",
  briefing: "Goals",
  briefingUrl: null,
  websiteUrl: null,
  logo: null,
  designMd: null,
  memoryEnabled: true,
  memoryModel: {
    id: "mistral/mistral-medium-latest",
    label: "Mistral Medium",
    region: "eu",
  },
  contextMd: null,
  contextMdUpdating: false,
  createdAt: new Date("2026-08-16T10:00:00.000Z"),
  updatedAt: new Date("2026-08-16T10:00:00.000Z"),
  taskCount: 2,
  jobCount: 1,
} as ProjectListItemType;

describe("ProjectListItem", () => {
  it("links the title row to the project detail page", () => {
    render(
      <ProjectListItem project={project} labels={labels} onDeleted={vi.fn()} />,
    );

    expect(screen.getByRole("link", { name: /Autumn Launch/ })).toHaveAttribute(
      "href",
      "/projects/project-1",
    );
  });
});
