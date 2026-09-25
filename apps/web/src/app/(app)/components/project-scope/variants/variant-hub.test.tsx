import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  pathname: "/tasks",
  search: "projectId=p-1",
  push: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => mocks.pathname,
  useSearchParams: () => new URLSearchParams(mocks.search),
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
vi.mock("@/app/projects/components/project-avatar", () => ({
  ProjectAvatar: () => <span aria-hidden />,
}));

import { hubSlots } from "./variant-hub";

const PLACES = ["header-center", "header-mobile"] as const;

function renderSlot(place: (typeof PLACES)[number]) {
  const Slot = hubSlots[place];
  if (!Slot) throw new Error(`No hub slot ${place}`);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <Slot />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.pathname = "/tasks";
  mocks.search = "projectId=p-1";
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve(
        Response.json({ project: { id: "p-1", name: "Acme", logo: null } }),
      ),
    ),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe.each(PLACES)("hub %s", (place) => {
  it("names the scoped project on a scoped workspace page", async () => {
    renderSlot(place);

    const link = await screen.findByRole("link", { name: "label: Acme" });
    expect(link.getAttribute("href")).toBe("/projects/p-1");
  });

  it("clears the scope in place", async () => {
    const user = userEvent.setup();
    renderSlot(place);

    await user.click(screen.getByRole("button", { name: "workspaceView" }));

    // select(null) on /tasks: the workspace version of the same page.
    expect(mocks.push).toHaveBeenCalledWith("/tasks");
  });

  it.each([
    ["a project page", "/projects/p-1", ""],
    ["an unscoped workspace page", "/tasks", ""],
    ["a page with no project version", "/chat", "projectId=p-1"],
  ])("renders nothing on %s", (_case, pathname, search) => {
    mocks.pathname = pathname;
    mocks.search = search;
    const { container } = renderSlot(place);

    expect(container).toBeEmptyDOMElement();
  });
});
