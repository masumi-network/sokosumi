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
  useTranslations: () => (key: string) => {
    const labels: Record<string, string> = {
      authenticate: "Authenticate",
      sendWith: "Send with",
      ctrl: "Ctrl",
    };
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

jest.mock("../expandable-markdown", () => ({
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
  }: {
    createdAt: string;
    status: TaskStatus | null;
    comment?: string | null;
    authenticationUrl?: string | null;
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
    origin: TaskEventOrigin.SOKOSUMI,
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

  it("shows auth button only for latest AUTHENTICATION_REQUIRED status event", () => {
    const events: TaskEvent[] = [
      createEvent("latest-comment", {
        createdAt: "2026-01-01T12:00:00.000Z",
        status: null,
        comment: "Looks good",
      }),
      createEvent("latest-status-auth", {
        createdAt: "2026-01-01T11:00:00.000Z",
        status: TaskStatus.AUTHENTICATION_REQUIRED,
        authenticationUrl: "https://example.com/oauth/authorize",
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
});
