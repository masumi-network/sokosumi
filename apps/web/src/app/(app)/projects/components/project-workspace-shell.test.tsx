import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  getProjectWorkspaceLabels,
  ProjectWorkspaceShell,
} from "@/app/projects/components/project-workspace-shell";
import {
  TASK_DETAIL_GRID_CLASS,
  TASK_DETAIL_SHELL_CLASS,
  TASK_DETAIL_SIDEBAR_CLASS,
} from "@/app/tasks/constants";

/**
 * A project page laid out like a task page: the task detail shell and grid,
 * a main column with the name, tabs and content, and a Properties rail.
 */

vi.mock("next/navigation", () => ({
  usePathname: () => "/projects/p1/memory",
}));

const { listSharedMock, activeOrganizationMock, newsletterEnabledMock } =
  vi.hoisted(() => ({
    listSharedMock: vi.fn(),
    activeOrganizationMock: vi.fn(),
    newsletterEnabledMock: vi.fn().mockResolvedValue(false),
  }));

vi.mock("next-intl/server", () => ({
  getTranslations: async () => (key: string) => key,
}));
vi.mock("@/lib/services/soko-bot.service", () => ({
  sokoBotService: { listShared: listSharedMock },
}));
vi.mock("@/lib/services/user.service", () => ({
  userService: { getActiveOrganizationId: activeOrganizationMock },
}));
vi.mock("@/lib/services/newsletter.service", () => ({
  newsletterService: { isEnabled: newsletterEnabledMock },
}));

const LABELS = {
  ariaLabel: "Project sections",
  design: "Design",
  memory: "Memory",
  overview: "Overview",
  properties: {
    title: "Properties",
    identifier: "Identifier",
    website: "Website",
    updated: "Updated",
    created: "Created",
  },
};

function renderShell(
  labels: typeof LABELS & { bots?: string; newsletter?: string } = LABELS,
) {
  return render(
    <ProjectWorkspaceShell
      createdAt="Yesterday"
      identifier="SOK"
      labels={labels}
      projectId="p1"
      projectName="Example project"
      updatedAt="Today"
      websiteUrl="https://example.com"
    >
      <p>area content</p>
    </ProjectWorkspaceShell>,
  );
}

function tabLinks() {
  const nav = screen.getByRole("navigation", { name: "Project sections" });
  return within(nav).getAllByRole("link");
}

describe("the project detail layout", () => {
  it("uses the task detail shell and grid, with no card", () => {
    const { container } = renderShell();

    const shell = container.firstElementChild as HTMLElement;
    for (const cls of TASK_DETAIL_SHELL_CLASS.split(/\s+/)) {
      expect(shell.classList).toContain(cls);
    }
    // Room above the name, on top of the app's own 16px padding.
    expect(shell.classList).toContain("pt-2");
    expect(shell.classList).toContain("md:pt-6");
    const grid = shell.firstElementChild as HTMLElement;
    for (const cls of TASK_DETAIL_GRID_CLASS.split(/\s+/)) {
      expect(grid.classList).toContain(cls);
    }
    expect(container.querySelector(".bg-card-background")).toBeNull();
  });

  it("spaces the name, rail, tabs and content as groups", () => {
    const { container } = renderShell();

    const grid = container.firstElementChild?.firstElementChild as HTMLElement;
    // 16px rows join the name to what follows it; 56px keeps the header's
    // actions clear of the rail.
    expect(grid.classList).toContain("gap-y-4");
    expect(grid.classList).toContain("xl:gap-x-14");
    // In one column the tabs start a new group: 32px after the Properties.
    const tabsBlock = screen.getByRole("navigation", {
      name: "Project sections",
    }).parentElement as HTMLElement;
    expect(tabsBlock.classList).toContain("max-xl:mt-4");
    expect(tabsBlock.classList).toContain("space-y-8");
  });

  it("puts the Properties rail in the task sidebar slot", () => {
    renderShell();

    const aside = screen.getByRole("complementary");
    for (const cls of TASK_DETAIL_SIDEBAR_CLASS.split(/\s+/)) {
      expect(aside.classList).toContain(cls);
    }
    expect(
      within(aside).getByRole("heading", { name: "Properties" }),
    ).toBeInTheDocument();
    expect(within(aside).getByText("Today")).toBeInTheDocument();
    expect(within(aside).getByText("Yesterday")).toBeInTheDocument();
    expect(
      within(aside).getByRole("link", { name: /example\.com/ }),
    ).toBeInTheDocument();
    expect(within(aside).getByText("SOK")).toBeInTheDocument();
    expect(within(aside).getByText("Identifier")).toBeInTheDocument();
  });

  it("orders name, rail, tabs, content, so the tabs touch their content", () => {
    renderShell();

    const heading = screen.getByRole("heading", { level: 1 });
    const aside = screen.getByRole("complementary");
    const nav = screen.getByRole("navigation", { name: "Project sections" });
    const content = screen.getByText("area content");
    const follows = (a: Node, b: Node) =>
      Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

    expect(follows(heading, aside)).toBe(true);
    expect(follows(aside, nav)).toBe(true);
    expect(follows(nav, content)).toBe(true);
    // Tabs and content share one block; the rail is never between them.
    expect(nav.parentElement?.contains(content)).toBe(true);
    expect(nav.parentElement?.contains(aside)).toBe(false);
  });

  it("marks the current tab", () => {
    renderShell();

    expect(screen.getByRole("link", { name: "Memory" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("navigates the three views a project actually has, and nothing else", () => {
    renderShell();

    // The studio, the calendar and Social are top-level destinations now: none
    // of them is an area *of* a project, so none of them is a tab here.
    expect(
      tabLinks().map((link) => [link.textContent, link.getAttribute("href")]),
    ).toEqual([
      ["Overview", "/projects/p1"],
      ["Design", "/projects/p1/design-md"],
      ["Memory", "/projects/p1/memory"],
    ]);
    expect(screen.queryByRole("link", { name: "Social" })).toBeNull();
  });

  it("adds the Bots tab when the labels carry one", () => {
    renderShell({ ...LABELS, bots: "Bots" });

    expect(tabLinks().at(-1)?.getAttribute("href")).toBe("/projects/p1/bots");
  });
});

describe("getProjectWorkspaceLabels", () => {
  beforeEach(() => {
    listSharedMock.mockResolvedValue(null);
    activeOrganizationMock.mockResolvedValue(null);
    newsletterEnabledMock.mockResolvedValue(false);
  });

  it("links Newsletter only when Core enables it", async () => {
    newsletterEnabledMock.mockResolvedValueOnce(true);
    const labels = await getProjectWorkspaceLabels();
    renderShell({ ...LABELS, newsletter: labels.newsletter });
    expect(
      screen.getByRole("link", { name: "tabs.newsletter" }),
    ).toHaveAttribute("href", "/projects/p1/newsletter");
  });

  it("hides Newsletter when Core disables it", async () => {
    newsletterEnabledMock.mockResolvedValueOnce(false);
    const labels = await getProjectWorkspaceLabels();
    renderShell({ ...LABELS, newsletter: labels.newsletter });
    expect(
      screen.queryByRole("link", { name: /newsletter/i }),
    ).not.toBeInTheDocument();
  });

  it("hides Newsletter when the availability read fails", async () => {
    newsletterEnabledMock.mockRejectedValueOnce(new Error("Core unavailable"));
    expect((await getProjectWorkspaceLabels()).newsletter).toBeUndefined();
  });

  it("offers the Bots tab when Core lists shared bots in an organization", async () => {
    listSharedMock.mockResolvedValue([]);
    activeOrganizationMock.mockResolvedValue("org-1");

    expect((await getProjectWorkspaceLabels()).bots).toBe("tabs.bots");
  });

  it("hides the Bots tab while Core sends no shared bots", async () => {
    listSharedMock.mockResolvedValue(null);
    activeOrganizationMock.mockResolvedValue("org-1");

    expect((await getProjectWorkspaceLabels()).bots).toBeUndefined();
  });

  it("hides the Bots tab when the shared-bot read fails", async () => {
    listSharedMock.mockRejectedValue(new Error("Core down"));
    activeOrganizationMock.mockResolvedValue("org-1");

    expect((await getProjectWorkspaceLabels()).bots).toBeUndefined();
  });

  it("hides the Bots tab in a personal workspace", async () => {
    listSharedMock.mockResolvedValue([]);
    activeOrganizationMock.mockResolvedValue(null);

    expect((await getProjectWorkspaceLabels()).bots).toBeUndefined();
  });
});
