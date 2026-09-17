import { removeTaskContextAttachmentLinks } from "@sokosumi/utils";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { TaskContextSectionContent } from "@/app/tasks/components/task-context-section";
import type { EffectiveDesignMdAttachment } from "@/lib/services/design-md.service";

vi.mock("@/app/projects/components/project-avatar", () => ({
  ProjectAvatar: ({ name, logo }: { name: string; logo?: string | null }) => (
    <span data-testid="project-avatar" data-logo={logo}>
      {name}
    </span>
  ),
}));

vi.mock("@/components/ui/favicon", () => ({
  Favicon: (props: { sources: string[]; alt?: string }) => (
    <img data-testid="favicon" src={props.sources[0]} alt={props.alt} />
  ),
}));

const defaultBrand: EffectiveDesignMdAttachment = {
  label: "DESIGN.md",
  url: "https://blob.example/org.md",
  owner: {
    type: "organization",
    name: "Acme",
    logo: "https://blob.example/acme.png",
  },
};

const project = {
  id: "project-1",
  name: "Autumn Launch",
  logo: "https://blob.example/project.png",
  designMd: { url: "https://blob.example/project-design.md" },
  briefingUrl: "https://blob.example/briefing.md",
  contextMd: {
    url: "https://blob.example/context.md",
    updatedAt: new Date("2026-08-16T08:00:00.000Z"),
  },
};

const labels = {
  briefing: "Briefing",
  memory: "Memory",
  brand: "Brand Guidelines",
  namedBrand: ({ name }: { name: string }) => `${name} brand guidelines`,
  personalBrand: "Personal brand guidelines",
};

describe("TaskContextSectionContent", () => {
  it("shows pressed pills for attached context without dropdown controls", () => {
    render(
      <TaskContextSectionContent
        title="Context"
        selection={{
          brandEnabled: true,
          brandSource: "project",
          brandUrl: project.designMd?.url ?? null,
          briefingEnabled: true,
          memoryEnabled: true,
        }}
        project={project}
        defaultBrand={defaultBrand}
        labels={labels}
      />,
    );

    expect(
      screen.getByRole("heading", { name: "Context" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Autumn Launch brand guidelines"),
    ).toBeInTheDocument();
    expect(screen.getByText("Briefing")).toBeInTheDocument();
    expect(screen.getByText("Memory")).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByRole("menuitem")).toBeNull();
    expect(screen.getByTestId("project-avatar")).toHaveAttribute(
      "data-logo",
      project.logo,
    );
  });

  it("hides the section when no context is attached", () => {
    const { container } = render(
      <TaskContextSectionContent
        title="Context"
        selection={{
          brandEnabled: false,
          brandSource: "default",
          brandUrl: null,
          briefingEnabled: false,
          memoryEnabled: false,
        }}
        project={project}
        defaultBrand={defaultBrand}
        labels={labels}
      />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it("still shows briefing and memory when they are attached without a project", () => {
    render(
      <TaskContextSectionContent
        title="Context"
        selection={{
          brandEnabled: true,
          brandSource: "default",
          brandUrl: defaultBrand.url,
          briefingEnabled: true,
          memoryEnabled: true,
        }}
        project={null}
        defaultBrand={defaultBrand}
        labels={labels}
      />,
    );

    expect(screen.getByText("Acme brand guidelines")).toBeInTheDocument();
    expect(screen.getByText("Briefing")).toBeInTheDocument();
    expect(screen.getByText("Memory")).toBeInTheDocument();
  });
});

describe("task detail description wiring", () => {
  it("strips context attachment links from the description body", () => {
    const markdown = [
      `[DESIGN.md](${project.designMd?.url})`,
      `[BRIEFING.md](${project.briefingUrl})`,
      `[CONTEXT.md](${project.contextMd?.url})`,
      "",
      "User prose only",
    ].join("\n");

    expect(removeTaskContextAttachmentLinks(markdown)).toBe("User prose only");
  });
});
