import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  enabled: vi.fn(),
  project: vi.fn(),
  settings: vi.fn(),
  list: vi.fn(),
  subscribers: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
  redirect: (path: string) => {
    throw new Error(`REDIRECT:${path}`);
  },
  usePathname: () => "/projects/p1/newsletter/subscribers",
}));
vi.mock("next-intl/server", () => ({
  getFormatter: async () => ({ dateTime: () => "Oct 23, 2026" }),
  getTranslations: async () => (key: string) => key,
}));
vi.mock("@/lib/services/newsletter.service", () => ({
  newsletterService: {
    isEnabled: mocks.enabled,
    getSettings: mocks.settings,
    listSubscribers: mocks.list,
  },
}));
vi.mock("@/lib/services/project.service", () => ({
  projectService: { getProjectById: mocks.project },
}));
vi.mock("@/app/projects/components/project-workspace-shell", () => ({
  getProjectWorkspaceLabels: async () => ({}),
  ProjectWorkspaceShell: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));
vi.mock("./subscribers", () => ({
  Subscribers: (props: object) => {
    mocks.subscribers(props);
    return <div>Subscriber list</div>;
  },
}));

import SubscribersPage from "./page";

const RESPONSE = {
  data: {
    subscribers: [],
    counts: { ACTIVE: 2, PENDING: 1, UNSUBSCRIBED: 0, BOUNCED: 0 },
  },
  meta: { pagination: { cursor: null, limit: 25, total: 3, nextCursor: null } },
};
const PROPS = {
  params: Promise.resolve({ projectId: "p1" }),
  searchParams: Promise.resolve({}),
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.enabled.mockResolvedValue(true);
  mocks.project.mockResolvedValue({ id: "p1", name: "Launch" });
  mocks.settings.mockResolvedValue({ id: "n1" });
  mocks.list.mockResolvedValue(RESPONSE);
});

describe("newsletter subscribers page", () => {
  it("hides the route when the feature is disabled", async () => {
    mocks.enabled.mockResolvedValue(false);
    await expect(SubscribersPage(PROPS)).rejects.toThrow("NOT_FOUND");
    expect(mocks.project).not.toHaveBeenCalled();
    expect(mocks.list).not.toHaveBeenCalled();
  });
  it("hides inaccessible projects", async () => {
    mocks.project.mockResolvedValue(null);
    await expect(SubscribersPage(PROPS)).rejects.toThrow("NOT_FOUND");
    expect(mocks.settings).not.toHaveBeenCalled();
  });
  it("returns to settings until a newsletter exists", async () => {
    mocks.settings.mockResolvedValue(null);
    await expect(SubscribersPage(PROPS)).rejects.toThrow(
      "REDIRECT:/projects/p1/newsletter",
    );
    expect(mocks.list).not.toHaveBeenCalled();
  });
  it("renders the shared nav with Subscribers selected and Core data", async () => {
    render(await SubscribersPage(PROPS));
    expect(
      screen.getByRole("link", { name: "Subscribers.title" }),
    ).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "settings" })).toHaveAttribute(
      "href",
      "/projects/p1/newsletter",
    );
    expect(mocks.list).toHaveBeenCalledWith("p1", { limit: 25 });
    expect(mocks.subscribers).toHaveBeenCalledWith({
      projectId: "p1",
      data: RESPONSE.data,
      pagination: RESPONSE.meta.pagination,
    });
  });
  it("forwards validated filters and the cursor to Core", async () => {
    const cursor = "22222222-2222-4222-8222-222222222222";
    await SubscribersPage({
      ...PROPS,
      searchParams: Promise.resolve({
        status: "ACTIVE",
        search: " example.com ",
        cursor,
      }),
    });
    expect(mocks.list).toHaveBeenCalledWith("p1", {
      limit: 25,
      status: "ACTIVE",
      search: "example.com",
      cursor,
    });
  });
  it("ignores forged statuses/cursors and bounds email search", async () => {
    await SubscribersPage({
      ...PROPS,
      searchParams: Promise.resolve({
        status: "FORGED",
        cursor: "invalid",
        search: "a".repeat(300),
      }),
    });
    expect(mocks.list).toHaveBeenCalledWith("p1", {
      limit: 25,
      search: "a".repeat(254),
    });
  });
  it("propagates read failures instead of showing an empty list", async () => {
    mocks.list.mockRejectedValue(new Error("Core unavailable"));
    await expect(SubscribersPage(PROPS)).rejects.toThrow("Core unavailable");
  });
});
