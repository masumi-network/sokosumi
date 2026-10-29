import type { ProjectListItem as ProjectListItemType } from "@sokosumi/core-client";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ProjectListItem } from "@/app/projects/components/project-list-item";
import { PROJECTS_CARD_LAYOUT_CLASS } from "@/app/projects/constants";

const { pinMock, unpinMock, refreshMock } = vi.hoisted(() => ({
  pinMock: vi.fn(),
  unpinMock: vi.fn(),
  refreshMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

vi.mock("@/app/projects/actions", () => ({
  pinProjectAction: pinMock,
  unpinProjectAction: unpinMock,
  hideProjectAction: vi.fn(),
  showProjectAction: vi.fn(),
}));

vi.mock("@/lib/actions/project/action", () => ({ closeProject: vi.fn() }));

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
  pinned: "Pinned",
  created: "Created",
  closed: "Closed",
  actions: {
    moreActions: "More actions",
    close: "Close",
    pin: { pin: "Pin", unpin: "Unpin", error: "Could not change the Pin." },
    hide: {
      hide: "Hide",
      show: "Show",
      hidden: "Project hidden",
      undo: "Undo",
      hideError: "Could not hide",
      showError: "Could not show",
    },
    closeDialog: {
      title: "Close project?",
      description: "Scheduled work will be resolved before closing.",
      reasonLabel: "Reason (optional)",
      reasonPlaceholder: "Why is this project closing?",
      confirm: "Close project",
      cancel: "Keep project open",
      success: "Project close started",
      error: "Unable to close project",
    },
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
  latestUpdate: null,
  createdAt: new Date("2026-08-16T10:00:00.000Z"),
  updatedAt: new Date("2026-08-16T10:00:00.000Z"),
  lastActivityAt: new Date("2026-08-20T09:30:00.000Z"),
  taskCount: 2,
  jobCount: 1,
  projectRevision: 0,
} as ProjectListItemType;

describe("ProjectListItem", () => {
  it("links the title row to the project detail page", () => {
    render(<ProjectListItem project={project} labels={labels} />);

    expect(screen.getByRole("link", { name: /Autumn Launch/ })).toHaveAttribute(
      "href",
      "/projects/project-1",
    );
  });

  it("offers Pin, Hide and Close from a menu beside the link, but not Edit", async () => {
    const user = userEvent.setup();
    render(<ProjectListItem project={project} labels={labels} />);

    const menu = screen.getByRole("button", { name: "More actions" });
    expect(screen.getByRole("link").contains(menu)).toBe(false);
    await user.click(menu);

    expect(
      screen.getAllByRole("menuitem").map((item) => item.textContent),
    ).toEqual(["Pin", "Hide", "Close"]);
  });

  it("stacks the name, the briefing and a footer down the card", () => {
    render(<ProjectListItem project={project} labels={labels} />);

    const link = screen.getByRole("link", { name: /Autumn Launch/ });
    expect(link).toHaveClass("flex-col", "flex-1");
    // Two lines of briefing, not one: a card has the height a row did not.
    expect(screen.getByText("Goals")).toHaveClass("line-clamp-2");
    // The card is a --background card inside the --card-background list
    // card; its hover steps to --card-background-hover, as task rows do. Pinned
    // exactly: "hover:bg-card-background" is a substring of the correct
    // class, so a toContain on the shorter name passes either way.
    //
    // The fill lives on the card, not the link: the menu button sits outside
    // the link, so a link-scoped fill would leave its corner unlit while the
    // pointer is over it.
    const row = link.closest("article");
    expect(row?.className.split(/\s+/)).toContain(
      "hover:bg-card-background-hover",
    );
    // The card is bordered, as task rows are. The link rounds too, so the
    // forced-colors outline that `outline-hidden` keeps follows the card's
    // corners; the menu button sits outside the link.
    expect(row?.className.split(/\s+/)).toEqual(
      expect.arrayContaining(["bg-background", "border", "rounded-lg"]),
    );
    expect(link.className.split(/\s+/)).toContain("rounded-lg");
    expect(link.className.split(/\s+/)).not.toContain("border");
    // Keyboard focus rings the whole card. A ring on the link alone would
    // stop at the menu button and draw a line through the card.
    expect(link.className.split(/\s+/)).toContain("outline-hidden");
    expect(row?.className.split(/\s+/)).toEqual(
      expect.arrayContaining([
        "has-[>a:focus-visible]:ring-2",
        "has-[>a:focus-visible]:ring-ring",
        "has-[>a:focus-visible]:outline-2",
        "has-[>a:focus-visible]:outline-transparent",
      ]),
    );

    const article = link.closest("article");
    for (const token of PROJECTS_CARD_LAYOUT_CLASS.split(/\s+/)) {
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

describe("ProjectListItem Pin", () => {
  it("marks a Pinned card beside its name, inside the link", () => {
    render(
      <ProjectListItem
        project={{
          ...project,
          starredAt: new Date("2026-09-01T10:00:00.000Z"),
        }}
        labels={labels}
      />,
    );

    const mark = screen.getByTestId("project-pinned-mark");
    expect(mark).toHaveTextContent("Pinned");
    expect(mark.previousElementSibling).toHaveTextContent("Autumn Launch");
    expect(mark.closest("a")).not.toBeNull();
  });

  it("shows no mark on a card the reader has not Pinned", () => {
    render(<ProjectListItem project={project} labels={labels} />);

    expect(screen.queryByTestId("project-pinned-mark")).not.toBeInTheDocument();
  });

  it("Unpins a Pinned card from its menu and refetches the page", async () => {
    const user = userEvent.setup();
    unpinMock.mockResolvedValue({});
    render(
      <ProjectListItem
        project={{
          ...project,
          starredAt: new Date("2026-09-01T10:00:00.000Z"),
        }}
        labels={labels}
      />,
    );

    await user.click(screen.getByRole("button", { name: "More actions" }));
    await user.click(screen.getByRole("menuitem", { name: "Unpin" }));

    await vi.waitFor(() =>
      expect(unpinMock).toHaveBeenCalledWith({ projectId: "project-1" }),
    );
    // Pins lead the Open view, so the page re-sorts once the write lands.
    await vi.waitFor(() => expect(refreshMock).toHaveBeenCalled());
  });

  it("puts the menu over the card's corner, outside the link", () => {
    render(<ProjectListItem project={project} labels={labels} />);

    const menu = screen.getByRole("button", { name: "More actions" });
    // A button nested in an anchor is invalid HTML, and the click would
    // navigate to the project instead.
    expect(menu.closest("a")).toBeNull();
    expect(menu).toHaveClass(
      "absolute",
      "top-2",
      "end-2",
      "pointer-fine:opacity-0",
      "pointer-fine:group-hover/card:opacity-100",
    );
  });
});

describe("ProjectListItem in the Hidden view", () => {
  it("offers Show instead of Hide, and no Pin", async () => {
    const user = userEvent.setup();
    render(<ProjectListItem project={project} labels={labels} hidden />);

    await user.click(screen.getByRole("button", { name: "More actions" }));

    expect(
      screen.getAllByRole("menuitem").map((item) => item.textContent),
    ).toEqual(["Show", "Close"]);
  });

  it("still opens the project", () => {
    render(<ProjectListItem project={project} labels={labels} hidden />);

    expect(screen.getByRole("link", { name: /Autumn Launch/ })).toHaveAttribute(
      "href",
      "/projects/project-1",
    );
  });
});

describe("ProjectListItem in the Closed view", () => {
  const closed = {
    ...project,
    starredAt: new Date("2026-09-01T10:00:00.000Z"),
    closedAt: new Date("2026-09-10T08:00:00.000Z"),
  };

  it("shows no Pin mark, even when a Pin outlived the close", () => {
    render(<ProjectListItem project={closed} labels={labels} />);

    expect(screen.queryByTestId("project-pinned-mark")).not.toBeInTheDocument();
  });

  it("has no menu: a Closed project lists here whether or not it is Hidden", () => {
    render(<ProjectListItem project={closed} labels={labels} />);

    expect(
      screen.queryByRole("button", { name: "More actions" }),
    ).not.toBeInTheDocument();
  });

  it("shows a Closed badge and the close date in place of last activity", () => {
    render(<ProjectListItem project={closed} labels={labels} />);

    expect(screen.getByText("Closed")).toHaveAttribute("data-slot", "badge");
    const stamp = screen.getByTestId("time-ago");
    expect(stamp).toHaveTextContent("ago:2026-09-10T08:00:00.000Z");
    expect(stamp).toHaveAttribute("data-title-prefix", "Closed");
  });

  it("still opens the project", () => {
    render(<ProjectListItem project={closed} labels={labels} />);

    expect(screen.getByRole("link", { name: /Autumn Launch/ })).toHaveAttribute(
      "href",
      "/projects/project-1",
    );
  });

  // A project mid-close and one whose close failed look the same on the list
  // item: `closingAt` is set and `closedAt` is not, because only a finished
  // close writes `closedAt`. Both stay Open.
  it.each([
    ["closing", new Date("2026-09-10T08:00:00.000Z")],
    ["close-failed", new Date("2026-08-01T08:00:00.000Z")],
  ])("keeps a %s project Open, with its Pin and activity", (_, closingAt) => {
    render(
      <ProjectListItem
        project={{
          ...project,
          starredAt: new Date("2026-09-01T10:00:00.000Z"),
          closingAt,
          closedAt: null,
        }}
        labels={labels}
      />,
    );

    expect(screen.queryByText("Closed")).not.toBeInTheDocument();
    expect(screen.getByTestId("project-pinned-mark")).toBeInTheDocument();
    expect(screen.getByTestId("time-ago")).toHaveAttribute(
      "data-title-prefix",
      "Last activity",
    );
  });
});
