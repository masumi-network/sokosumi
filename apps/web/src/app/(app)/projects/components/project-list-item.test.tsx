import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ProjectListItem } from "@/app/projects/components/project-list-item";
import { PROJECTS_ITEM_LAYOUT_CLASS } from "@/app/projects/constants";
import type { ProjectListItem as ProjectListItemType } from "@/lib/clients/generated/core/types.gen";

const labels = {
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
    render(<ProjectListItem project={project} labels={labels} />);

    expect(screen.getByRole("link", { name: /Autumn Launch/ })).toHaveAttribute(
      "href",
      "/projects/project-1",
    );
  });

  it("does not expose overflow row actions on the browse surface", () => {
    render(<ProjectListItem project={project} labels={labels} />);

    expect(
      screen.queryByRole("button", { name: /more/i }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("menuitem", { name: /edit|delete|view/i }),
    ).not.toBeInTheDocument();
  });

  it("renders as a bordered card on mobile and a list row from md up", () => {
    render(<ProjectListItem project={project} labels={labels} />);

    const link = screen.getByRole("link", { name: /Autumn Launch/ });
    expect(link.className).toContain("border");
    expect(link.className).toContain("rounded-lg");
    expect(link.className).toContain("md:border-0");
    expect(link.className).toContain("p-3");

    const article = link.closest("article");
    for (const token of PROJECTS_ITEM_LAYOUT_CLASS.split(/\s+/)) {
      expect(article?.className).toContain(token);
    }
  });

  it("strips markdown from briefing subtitle to plain text", () => {
    const projectWithMarkdown = {
      ...project,
      briefing:
        "Campaign briefing — Begin Wallet **Working title:** Your crypto journey begins here **Status:** Draft",
    };

    render(<ProjectListItem project={projectWithMarkdown} labels={labels} />);

    const briefingElement = screen.getByText(
      /Campaign briefing — Begin Wallet/,
    );

    expect(briefingElement).toBeInTheDocument();
    expect(briefingElement.textContent).toContain("Working title:");
    expect(briefingElement.textContent).not.toContain("**Working title:**");
    expect(briefingElement.textContent).not.toContain("**Status:**");

    const strongElements = briefingElement.querySelectorAll("strong");
    expect(strongElements.length).toBe(0);
  });

  it("shows em dash when briefing is empty", () => {
    const projectWithoutBriefing = {
      ...project,
      briefing: null,
    };

    render(
      <ProjectListItem project={projectWithoutBriefing} labels={labels} />,
    );

    expect(screen.getByText("—")).toBeInTheDocument();
  });
});
