import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const hasCurrentUserCalendarBetaAccessMock = vi.fn();
const getProjectByIdMock = vi.fn();
const listSocialPostsMock = vi.fn();
const listSocialConnectionsMock = vi.fn();
const projectSocialPostsMock = vi.fn();
const projectSocialAccountsMock = vi.fn();

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  // SOK-1202 harness: the project header reads the scope variant.
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("next/server", () => ({
  connection: vi.fn(),
}));

vi.mock("next-intl/server", async () => {
  const { createTestFormatter } = await import("@/test/intl-formatter");
  return {
    getFormatter: async () => createTestFormatter(),
    getTranslations: async () => (key: string) => key,
  };
});

vi.mock("@/lib/calendar-beta-access.server", () => ({
  hasCurrentUserCalendarBetaAccess: () =>
    hasCurrentUserCalendarBetaAccessMock(),
}));

vi.mock("@/lib/services/project.service", () => ({
  projectService: {
    getProjectById: (projectId: string) => getProjectByIdMock(projectId),
    listSocialPosts: (...args: unknown[]) => listSocialPostsMock(...args),
    listSocialConnections: (projectId: string) =>
      listSocialConnectionsMock(projectId),
  },
}));

vi.mock("@/app/projects/components/social-posts/project-social-posts", () => ({
  ProjectSocialPosts: (props: unknown) => {
    projectSocialPostsMock(props);
    return <div data-testid="project-social-posts" />;
  },
}));

vi.mock("@/app/projects/components/project-social-accounts", () => ({
  ProjectSocialAccounts: (props: unknown) => {
    projectSocialAccountsMock(props);
    return <div data-testid="project-social-accounts" />;
  },
}));

import ProjectSocialPage from "./page";

const PROJECT = {
  id: "project-1",
  name: "Launch plan",
  logo: null,
  websiteUrl: null,
  createdAt: new Date("2026-06-01T00:00:00.000Z"),
  updatedAt: new Date("2026-06-02T00:00:00.000Z"),
};

function buildConnection(status: "active" | "disconnected", id: string) {
  return {
    id,
    provider: "x" as const,
    externalHandle: "sokosumi",
    status,
    connectedAt: new Date("2026-09-03T10:00:00.000Z"),
    disconnectedAt: null,
  };
}

describe("ProjectSocialPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hasCurrentUserCalendarBetaAccessMock.mockResolvedValue(true);
    getProjectByIdMock.mockResolvedValue(PROJECT);
    listSocialPostsMock.mockResolvedValue({ posts: [], nextCursor: null });
    listSocialConnectionsMock.mockResolvedValue([]);
  });

  it("does not load Project data outside the Calendar beta", async () => {
    hasCurrentUserCalendarBetaAccessMock.mockResolvedValue(false);

    await expect(
      ProjectSocialPage({ params: Promise.resolve({ projectId: PROJECT.id }) }),
    ).rejects.toThrow("NEXT_NOT_FOUND");

    expect(getProjectByIdMock).not.toHaveBeenCalled();
    expect(listSocialPostsMock).not.toHaveBeenCalled();
    expect(listSocialConnectionsMock).not.toHaveBeenCalled();
  });

  it("returns 404 for an unknown Project", async () => {
    getProjectByIdMock.mockResolvedValue(null);

    await expect(
      ProjectSocialPage({ params: Promise.resolve({ projectId: "missing" }) }),
    ).rejects.toThrow("NEXT_NOT_FOUND");

    expect(listSocialPostsMock).not.toHaveBeenCalled();
    expect(listSocialConnectionsMock).not.toHaveBeenCalled();
  });

  it("renders the header, posts with active connections only, and every connection for the accounts section", async () => {
    const posts = [{ id: "post-1" }];
    const active = buildConnection("active", "connection-1");
    const disconnected = buildConnection("disconnected", "connection-2");
    listSocialPostsMock.mockResolvedValueOnce({
      posts,
      nextCursor: "next-upcoming",
    });
    listSocialConnectionsMock.mockResolvedValue([active, disconnected]);

    render(
      await ProjectSocialPage({
        params: Promise.resolve({ projectId: PROJECT.id }),
      }),
    );

    expect(getProjectByIdMock).toHaveBeenCalledWith(PROJECT.id);
    expect(listSocialPostsMock).toHaveBeenCalledTimes(3);
    expect(listSocialPostsMock).toHaveBeenCalledWith(PROJECT.id, {
      statuses: ["DRAFT"],
    });
    expect(listSocialPostsMock).toHaveBeenCalledWith(PROJECT.id, {
      statuses: ["SCHEDULED", "PUBLISHING"],
    });
    expect(listSocialPostsMock).toHaveBeenCalledWith(PROJECT.id, {
      statuses: ["PUBLISHED", "FAILED", "MISSED", "CANCELED"],
    });
    expect(listSocialConnectionsMock).toHaveBeenCalledWith(PROJECT.id);
    expect(screen.getByRole("link", { name: "backToProject" })).toHaveAttribute(
      "href",
      "/projects/project-1",
    );
    expect(screen.getByTestId("project-social-posts")).toBeInTheDocument();
    expect(projectSocialPostsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: PROJECT.id,
        posts,
        connections: [expect.objectContaining({ id: "connection-1" })],
      }),
    );
    expect(screen.getByTestId("project-social-accounts")).toBeInTheDocument();
    expect(projectSocialAccountsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: PROJECT.id,
        connections: [active, disconnected],
      }),
    );
  });
});
