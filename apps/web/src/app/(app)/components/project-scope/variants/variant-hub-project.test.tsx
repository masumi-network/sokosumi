import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import type { ComponentProps } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  pathname: "/projects/p-1",
  push: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => mocks.pathname,
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: mocks.push }),
}));
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));
vi.mock("next/link", () => ({
  default: ({
    prefetch: _prefetch,
    ...props
  }: ComponentProps<"a"> & { prefetch?: boolean }) => <a {...props} />,
}));
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }));
vi.mock("@/lib/auth/auth.client", () => ({
  useSession: () => ({
    data: {
      user: { id: "user-1" },
      session: { activeOrganizationId: "org-1" },
    },
    isPending: false,
    error: null,
  }),
}));
vi.mock("@/app/projects/actions", () => ({
  loadMoreProjects: vi.fn(),
  loadPinnedProjects: vi.fn(),
}));
vi.mock("@/app/projects/components/inline-create-project-modal", () => ({
  InlineCreateProjectModal: () => null,
}));

import { HubProjectHeader } from "./variant-hub-project";

function renderHeader(calendarBeta?: boolean) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <HubProjectHeader calendarBeta={calendarBeta} />
    </QueryClientProvider>,
  );
  return within(screen.getByRole("navigation", { name: "sections" }));
}

function sectionLinks(nav: ReturnType<typeof renderHeader>) {
  return nav
    .getAllByRole("link")
    .map((link) => [link.textContent, link.getAttribute("href")]);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.pathname = "/projects/p-1";
});

describe("HubProjectHeader", () => {
  it("lists every section, Calendar and Social included, with Calendar beta", () => {
    const nav = renderHeader(true);

    expect(sectionLinks(nav)).toEqual([
      ["overview", "/projects/p-1"],
      ["tasks", "/tasks?projectId=p-1"],
      ["schedules", "/schedules?projectId=p-1"],
      // The project page, where the hub nav lives, not /calendar?projectId=.
      ["calendar", "/projects/p-1/calendar"],
      ["files", "/drive?view=tasks&projectId=p-1"],
      ["history", "/history?projectId=p-1"],
      ["social", "/projects/p-1/social"],
    ]);
  });

  it("drops Calendar and Social without Calendar beta", () => {
    const nav = renderHeader();

    expect(sectionLinks(nav).map(([name]) => name)).toEqual([
      "overview",
      "tasks",
      "schedules",
      "files",
      "history",
    ]);
  });

  it("marks only the section of the current page", () => {
    mocks.pathname = "/projects/p-1/calendar";
    const nav = renderHeader(true);

    const current = nav
      .getAllByRole("link")
      .filter((link) => link.getAttribute("aria-current") === "page");
    expect(current.map((link) => link.textContent)).toEqual(["calendar"]);
  });

  it("renders nothing off a project page", () => {
    mocks.pathname = "/tasks";
    const client = new QueryClient();
    const { container } = render(
      <QueryClientProvider client={client}>
        <HubProjectHeader calendarBeta />
      </QueryClientProvider>,
    );

    expect(container).toBeEmptyDOMElement();
  });
});
