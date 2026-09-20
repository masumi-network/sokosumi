import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ProjectListItem } from "@/app/projects/components/project-list-item";
import { PROJECTS_LIST_ROW_LAYOUT_CLASS } from "@/app/projects/constants";
import type { ProjectListItem as ProjectListItemType } from "@/lib/clients/generated/core/types.gen";

vi.mock("@/components/time-ago", () => ({
  TimeAgo: ({
    date,
    titlePrefix,
  }: {
    date: string | Date;
    titlePrefix?: string;
  }) => (
    <span data-testid="time-ago" data-title-prefix={titlePrefix}>
      {`ago:${date instanceof Date ? date.toISOString() : date}`}
    </span>
  ),
}));

const labels = {
  counts: {
    tasks: "Tasks",
    jobs: "Jobs",
  },
  lastActivity: "Last activity",
  created: "Created",
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
  latestUpdate: null,
  createdAt: new Date("2026-08-16T10:00:00.000Z"),
  updatedAt: new Date("2026-08-16T10:00:00.000Z"),
  lastActivityAt: new Date("2026-08-20T09:30:00.000Z"),
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

  it("renders as a horizontal list row with no mobile card chrome", () => {
    render(<ProjectListItem project={project} labels={labels} />);

    const link = screen.getByRole("link", { name: /Autumn Launch/ });
    expect(link.className).toContain("flex-row");
    expect(link.className).toContain("items-center");
    expect(link.className).toContain("gap-4");
    // The row sits inside PROJECTS_BROWSE_LAYOUT_CLASS, which is
    // --card-background, so the hover has to be the step past it. Pinned
    // exactly: "hover:bg-card-background" is a substring of the correct
    // class, so a toContain on the shorter name passes either way.
    expect(link.className.split(/\s+/)).toContain(
      "hover:bg-card-background-hover",
    );
    expect(link.className).toContain("rounded-none");
    expect(link.className).toContain("md:rounded-lg");
    expect(link.className).not.toContain("border-border");
    expect(link.className).not.toContain("bg-overlay");
    expect(link.className.split(/\s+/)).not.toContain("border");

    const article = link.closest("article");
    for (const token of PROJECTS_LIST_ROW_LAYOUT_CLASS.split(/\s+/)) {
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

  it("omits the briefing line when the briefing is empty", () => {
    const projectWithoutBriefing = {
      ...project,
      briefing: null,
    };

    render(
      <ProjectListItem project={projectWithoutBriefing} labels={labels} />,
    );

    expect(screen.queryByText("—")).not.toBeInTheDocument();
  });

  it("hides the jobs pill when the project has no jobs", () => {
    render(
      <ProjectListItem project={{ ...project, jobCount: 0 }} labels={labels} />,
    );

    expect(screen.queryByLabelText(/^Jobs/)).not.toBeInTheDocument();
    expect(screen.getByLabelText(/^Tasks/)).toBeInTheDocument();
  });

  it("hides the tasks pill when the project has no tasks", () => {
    render(
      <ProjectListItem
        project={{ ...project, taskCount: 0 }}
        labels={labels}
      />,
    );

    expect(screen.queryByLabelText(/^Tasks/)).not.toBeInTheDocument();
    expect(screen.getByLabelText(/^Jobs/)).toBeInTheDocument();
  });

  it("stamps the row with its last activity", () => {
    render(<ProjectListItem project={project} labels={labels} />);

    const stamp = screen.getByTestId("time-ago");
    expect(stamp).toHaveTextContent("ago:2026-08-20T09:30:00.000Z");
    expect(stamp).toHaveAttribute("data-title-prefix", "Last activity");
    expect(screen.queryByText("Created")).not.toBeInTheDocument();
  });

  it("stamps creation instead when the project has no activity yet", () => {
    const untouched = {
      ...project,
      lastActivityAt: project.createdAt,
    };

    render(<ProjectListItem project={untouched} labels={labels} />);

    const stamp = screen.getByTestId("time-ago");
    expect(stamp).toHaveTextContent("ago:2026-08-16T10:00:00.000Z");
    expect(stamp).toHaveAttribute("data-title-prefix", "Created");
    expect(screen.getByText("Created")).toBeInTheDocument();
  });
});
