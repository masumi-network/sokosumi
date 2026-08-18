import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import {
  getDefaultTaskContextSelection,
  TaskContextAttachmentsField,
  type TaskContextAttachmentsSelection,
} from "@/app/tasks/components/task-context-attachments";
import type { EffectiveDesignMdAttachment } from "@/lib/services/design-md.service";

const { onGeneratedSpy } = vi.hoisted(() => ({ onGeneratedSpy: vi.fn() }));

vi.mock("next-intl", () => ({
  useFormatter: () => ({
    relativeTime: () => "2 hours ago",
  }),
  useNow: () => new Date("2026-08-16T10:00:00.000Z"),
  useTranslations: () => (key: string, values?: Record<string, unknown>) => {
    if (key === "info") {
      return "DESIGN.md, BRIEFING.md, and CONTEXT.md";
    }
    return values ? `${key}:${JSON.stringify(values)}` : key;
  },
}));

vi.mock("@/app/projects/components/project-avatar", () => ({
  ProjectAvatar: ({ name, logo }: { name: string; logo?: string | null }) => (
    <span data-testid="project-avatar" data-logo={logo}>
      {name}
    </span>
  ),
}));

vi.mock("@/components/design-md", () => ({
  DesignMdAdHocDialog: ({
    open,
    onGenerated,
  }: {
    open: boolean;
    onGenerated: (attachment: {
      label: string;
      url: string;
      sourceUrl: string;
    }) => void;
  }) => {
    onGeneratedSpy.mockImplementation(onGenerated);
    return open ? <div data-testid="adhoc-dialog" /> : null;
  },
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

const selection: TaskContextAttachmentsSelection = {
  brand: { enabled: true, source: "project", custom: null },
  briefingEnabled: true,
  contextMdEnabled: true,
};

describe("TaskContextAttachmentsField", () => {
  it("defaults all context on and prefers project branding when available", () => {
    expect(getDefaultTaskContextSelection(project)).toEqual({
      brand: { enabled: true, source: "project", custom: null },
      briefingEnabled: true,
      contextMdEnabled: true,
    });
    expect(getDefaultTaskContextSelection()).toEqual({
      brand: { enabled: true, source: "default", custom: null },
      briefingEnabled: true,
      contextMdEnabled: true,
    });
  });

  it("shows one compact row with all available context enabled", () => {
    render(
      <TaskContextAttachmentsField
        defaultBrand={defaultBrand}
        project={project}
        selection={selection}
        onSelectionChange={vi.fn()}
      />,
    );

    expect(screen.getByText("label")).toBeInTheDocument();
    const brandButton = screen.getByRole("button", {
      name: 'namedBrand:{"name":"Autumn Launch"}',
    });
    const briefingButton = screen.getByRole("button", { name: "briefing" });
    expect(brandButton).toHaveAttribute("aria-pressed", "true");
    expect(brandButton.parentElement).toHaveClass("h-7", "text-xs");
    expect(briefingButton).toHaveAttribute("aria-pressed", "true");
    expect(briefingButton).toHaveClass("h-7", "text-xs");
    expect(screen.getByRole("button", { name: /memory/ })).toHaveTextContent(
      "2 hours ago",
    );
    expect(screen.getByTestId("project-avatar")).toHaveAttribute(
      "data-logo",
      project.logo,
    );
  });

  it("only shows project pills backed by project files", () => {
    render(
      <TaskContextAttachmentsField
        defaultBrand={defaultBrand}
        selection={{
          ...selection,
          brand: { enabled: true, source: "default", custom: null },
        }}
        onSelectionChange={vi.fn()}
      />,
    );

    expect(screen.queryByRole("button", { name: "briefing" })).toBeNull();
    expect(screen.queryByRole("button", { name: /memory/ })).toBeNull();
  });

  it("toggles briefing independently", async () => {
    const user = userEvent.setup();
    const onSelectionChange = vi.fn();

    render(
      <TaskContextAttachmentsField
        defaultBrand={defaultBrand}
        project={project}
        selection={selection}
        onSelectionChange={onSelectionChange}
      />,
    );

    await user.click(screen.getByRole("button", { name: "briefing" }));

    expect(onSelectionChange).toHaveBeenCalledWith({
      ...selection,
      briefingEnabled: false,
    });
  });

  it("switches between project and workspace brand sources", async () => {
    const user = userEvent.setup();
    const onSelectionChange = vi.fn();

    render(
      <TaskContextAttachmentsField
        defaultBrand={defaultBrand}
        project={project}
        selection={selection}
        onSelectionChange={onSelectionChange}
      />,
    );

    await user.click(screen.getByRole("button", { name: "brandMenuAria" }));
    await user.click(
      screen.getByRole("menuitem", { name: "organizationBrand" }),
    );

    expect(onSelectionChange).toHaveBeenCalledWith({
      ...selection,
      brand: { enabled: true, source: "default", custom: null },
    });
  });

  it("opens the website flow and adopts its generated DESIGN.md", async () => {
    const user = userEvent.setup();
    const onSelectionChange = vi.fn();

    render(
      <TaskContextAttachmentsField
        defaultBrand={defaultBrand}
        project={project}
        selection={selection}
        onSelectionChange={onSelectionChange}
      />,
    );

    await user.click(screen.getByRole("button", { name: "brandMenuAria" }));
    await user.click(screen.getByRole("menuitem", { name: "otherWebsite" }));
    expect(screen.getByTestId("adhoc-dialog")).toBeInTheDocument();

    const custom = {
      label: "DESIGN.md",
      url: "https://blob.example/design-md/adhoc/user-1/hash.md",
      sourceUrl: "https://www.example.com",
    };
    onGeneratedSpy(custom);

    expect(onSelectionChange).toHaveBeenCalledWith({
      ...selection,
      brand: { enabled: true, source: "custom", custom },
    });
  });

  it("uses one info hover for all three file names", async () => {
    const user = userEvent.setup();

    render(
      <TaskContextAttachmentsField
        defaultBrand={defaultBrand}
        project={project}
        selection={selection}
        onSelectionChange={vi.fn()}
      />,
    );

    await user.hover(screen.getByRole("button", { name: "infoAria" }));

    const info = await screen.findByText(
      "DESIGN.md, BRIEFING.md, and CONTEXT.md",
    );
    expect(info).toBeInTheDocument();
  });
});
