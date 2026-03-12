import "@testing-library/jest-dom";

import { TaskEventOrigin, TaskStatus } from "@sokosumi/database";
import { render, screen } from "@testing-library/react";

import { TaskActivitySection } from "@/app/tasks/components/task-activity";
import type { TaskEvent } from "@/lib/types/task";

jest.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: jest.fn(),
  }),
}));

jest.mock("next-intl", () => ({
  useLocale: () => "en",
  useTranslations: () => (key: string, values?: Record<string, string>) => {
    const labels: Record<string, string> = {
      authenticate: "Authenticate",
      "billingCta.upgradePlan": "Get more credits",
      "billingCta.addCredits": "Add credits",
      "billingCta.placeholder":
        "This task needs credits to continue. Open billing to proceed.",
      sendWith: "Send with",
      ctrl: "Ctrl",
      "originApp.sokosumi": "Sokosumi",
      "originApp.slack": "Slack",
      "originApp.teams": "Teams",
      "originApp.email": "Email",
      "originApp.linear": "Linear",
      "originApp.github": "GitHub",
      "originApp.whatsapp": "WhatsApp",
      "originApp.telegram": "Telegram",
      "originApp.signal": "Signal",
      "originApp.chat": "Chat",
      "originApp.unknown": "Unknown",
    };
    if (key === "originFromApp") {
      return `from ${values?.appName ?? ""}`.trim();
    }
    return labels[key] ?? key;
  },
}));

jest.mock("@/hooks/use-os-detection", () => ({
  useOSDetection: () => ({
    os: "MacOS",
    isMobile: false,
  }),
}));

jest.mock("@/lib/actions/task/action", () => ({
  createTaskComment: jest.fn(),
}));

jest.mock("@/components/expandable-markdown", () => ({
  ExpandableMarkdown: ({ content }: { content: string }) => (
    <div>{content}</div>
  ),
}));

function createEvent(
  id: string,
  {
    createdAt,
    status,
    comment = null,
    authenticationUrl = null,
    origin = TaskEventOrigin.SOKOSUMI,
  }: {
    createdAt: string;
    status: TaskStatus | null;
    comment?: string | null;
    authenticationUrl?: string | null;
    origin?: TaskEventOrigin;
  },
): TaskEvent {
  return {
    id,
    createdAt,
    updatedAt: createdAt,
    taskId: "task-1",
    status,
    comment,
    authenticationUrl,
    origin,
    userId: "user-1",
    coworkerId: null,
    transactionId: null,
  } as unknown as TaskEvent;
}

const baseProps = {
  taskId: "task-1",
  title: "Activity",
  placeholder: "Write a comment...",
  attachLabel: "Attach",
  submitLabel: "Submit",
  actorCoworkerLabel: "Coworker",
  actorUserLabel: "User",
  actorSystemLabel: "System",
  actionCommentedLabel: "commented",
  actionUpdatedStatusLabel: "updated status",
  events: [] as TaskEvent[],
  currentUser: {
    id: "user-1",
    name: "User",
    image: null,
  },
};

describe("TaskActivitySection", () => {
  it("does not show auth button when latest status is not AUTHENTICATION_REQUIRED", () => {
    const events: TaskEvent[] = [
      createEvent("older-auth", {
        createdAt: "2026-01-01T10:00:00.000Z",
        status: TaskStatus.AUTHENTICATION_REQUIRED,
        authenticationUrl: "https://example.com/auth",
      }),
      createEvent("latest-running", {
        createdAt: "2026-01-01T11:00:00.000Z",
        status: TaskStatus.RUNNING,
      }),
    ];

    render(<TaskActivitySection {...baseProps} events={events} />);

    expect(
      screen.queryByRole("link", { name: "Authenticate" }),
    ).not.toBeInTheDocument();
  });

  it("shows auth button when latest event is AUTHENTICATION_REQUIRED", () => {
    const events: TaskEvent[] = [
      createEvent("latest-status-auth", {
        createdAt: "2026-01-01T12:00:00.000Z",
        status: TaskStatus.AUTHENTICATION_REQUIRED,
        authenticationUrl: "https://example.com/oauth/authorize",
      }),
      createEvent("older-comment", {
        createdAt: "2026-01-01T11:00:00.000Z",
        status: null,
        comment: "Looks good",
      }),
      createEvent("older-status-running", {
        createdAt: "2026-01-01T10:00:00.000Z",
        status: TaskStatus.RUNNING,
      }),
    ];

    render(<TaskActivitySection {...baseProps} events={events} />);

    const authLink = screen.getByRole("link", { name: "Authenticate" });
    expect(authLink).toHaveAttribute(
      "href",
      "https://example.com/oauth/authorize",
    );
    expect(screen.getAllByRole("link", { name: "Authenticate" })).toHaveLength(
      1,
    );
  });

  it("does not show auth button when latest event is a comment", () => {
    const events: TaskEvent[] = [
      createEvent("latest-comment", {
        createdAt: "2026-01-01T12:00:00.000Z",
        status: null,
        comment: "Looks good",
      }),
      createEvent("older-status-auth", {
        createdAt: "2026-01-01T11:00:00.000Z",
        status: TaskStatus.AUTHENTICATION_REQUIRED,
        authenticationUrl: "https://example.com/oauth/authorize",
      }),
    ];

    render(<TaskActivitySection {...baseProps} events={events} />);

    expect(
      screen.queryByRole("link", { name: "Authenticate" }),
    ).not.toBeInTheDocument();
  });

  it("renders a status dot instead of avatar for status-only events", () => {
    const events: TaskEvent[] = [
      createEvent("latest-running", {
        createdAt: "2026-01-01T12:00:00.000Z",
        status: TaskStatus.RUNNING,
      }),
    ];

    render(
      <TaskActivitySection
        {...baseProps}
        events={events}
        userById={{
          "user-1": {
            name: "Alice",
            image: "https://example.com/alice.png",
          },
        }}
      />,
    );

    const dot = screen.getByTestId("status-dot-latest-running");
    expect(dot).toHaveClass("size-1.5");
    expect(dot).toHaveClass("bg-amber-500");
    expect(
      screen.queryByRole("img", { name: "Alice" }),
    ).not.toBeInTheDocument();
  });

  it("renders extracted file and link sources for markdown comments", () => {
    const events: TaskEvent[] = [
      createEvent("latest-comment-with-sources", {
        createdAt: "2026-01-01T12:00:00.000Z",
        status: null,
        comment:
          "Please check [Report](https://example.com/report.pdf) and [Docs](https://docs.example.com/article).",
      }),
    ];

    render(<TaskActivitySection {...baseProps} events={events} />);

    expect(screen.getByRole("link", { name: /report\.pdf/i })).toHaveAttribute(
      "href",
      "https://example.com/report.pdf",
    );
    expect(
      screen.getByRole("link", { name: /docs\.example\.com/i }),
    ).toHaveAttribute("href", "https://docs.example.com/article");
  });

  it("renders origin app text and icon alongside action", () => {
    const events: TaskEvent[] = [
      createEvent("latest-sokosumi", {
        createdAt: "2026-01-01T12:00:00.000Z",
        status: null,
        comment: "Posted in app",
        origin: TaskEventOrigin.SOKOSUMI,
      }),
      createEvent("older-email", {
        createdAt: "2026-01-01T11:00:00.000Z",
        status: null,
        comment: "Sent by email",
        origin: TaskEventOrigin.EMAIL,
      }),
    ];

    render(<TaskActivitySection {...baseProps} events={events} />);

    expect(screen.getByText("from Sokosumi")).toBeInTheDocument();
    expect(screen.getByText("from Email")).toBeInTheDocument();
    expect(screen.getByLabelText("from Sokosumi")).toBeInTheDocument();
    expect(screen.getByLabelText("from Email")).toBeInTheDocument();
  });

  it("shows upgrade plan billing CTA for latest out-of-credits event on free plan", () => {
    const events: TaskEvent[] = [
      createEvent("latest-out-of-credits", {
        createdAt: "2026-01-01T12:00:00.000Z",
        status: TaskStatus.OUT_OF_CREDITS,
      }),
    ];

    render(
      <TaskActivitySection {...baseProps} events={events} isFreePlan={true} />,
    );

    const cta = screen.getByRole("link", { name: "Get more credits" });
    expect(cta).toHaveAttribute("href", "/billing?tab=subscription");
    expect(
      screen.getByText(
        "This task needs credits to continue. Open billing to proceed.",
      ),
    ).toBeInTheDocument();
  });

  it("does not show billing CTA for latest credits-topped-up event", () => {
    const events: TaskEvent[] = [
      createEvent("latest-credits-topped-up", {
        createdAt: "2026-01-01T12:00:00.000Z",
        status: TaskStatus.CREDITS_TOPPED_UP,
      }),
    ];

    render(
      <TaskActivitySection {...baseProps} events={events} isFreePlan={false} />,
    );

    expect(
      screen.queryByRole("link", { name: "Get more credits" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Add credits" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(
        "This task needs credits to continue. Open billing to proceed.",
      ),
    ).not.toBeInTheDocument();
  });

  it("does not show billing CTA when out-of-credits event is not latest", () => {
    const events: TaskEvent[] = [
      createEvent("latest-running", {
        createdAt: "2026-01-01T12:00:00.000Z",
        status: TaskStatus.RUNNING,
      }),
      createEvent("older-out-of-credits", {
        createdAt: "2026-01-01T11:00:00.000Z",
        status: TaskStatus.OUT_OF_CREDITS,
      }),
    ];

    render(<TaskActivitySection {...baseProps} events={events} />);

    expect(
      screen.queryByRole("link", { name: "Get more credits" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Add credits" }),
    ).not.toBeInTheDocument();
  });
});
