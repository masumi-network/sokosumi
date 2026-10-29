import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  pathname: "/tasks",
  search: "",
  push: vi.fn(),
  fetch: vi.fn(),
  loadPinned: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => mocks.pathname,
  useSearchParams: () => new URLSearchParams(mocks.search),
  useRouter: () => ({ push: mocks.push }),
}));
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
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
vi.mock("@/lib/project-scope-list.client", () => ({
  fetchScopeList: (path: string) =>
    path.startsWith("/api/project-scope/pinned")
      ? mocks.loadPinned()
      : Promise.resolve({ projects: [], nextCursor: null }),
}));
vi.mock("@/app/projects/components/inline-create-project-modal", () => ({
  InlineCreateProjectModal: () => null,
}));
vi.mock("@/app/projects/components/project-avatar", () => ({
  ProjectAvatar: () => <span aria-hidden />,
}));

import { HeaderProjectScope } from "./header-project-scope";
import { closedScopeProjectResponse } from "./project-scope-fixtures";

function renderScope() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <HeaderProjectScope />
    </QueryClientProvider>,
  );
}

function trigger() {
  return screen.getByTestId("project-scope-header-trigger");
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.pathname = "/tasks";
  mocks.search = "";
  mocks.fetch.mockImplementation(() =>
    Promise.resolve(
      Response.json({ project: { id: "p-1", name: "Acme", logo: null } }),
    ),
  );
  vi.stubGlobal("fetch", mocks.fetch);
  mocks.loadPinned.mockResolvedValue([]);
  localStorage.clear();
  sessionStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("header project scope", () => {
  it("names All projects when no project is picked", () => {
    renderScope();

    expect(trigger()).toHaveTextContent("allProjects");
    expect(trigger()).toHaveAccessibleName("label: allProjects");
  });

  it("names the picked project", async () => {
    mocks.search = "projectId=p-1";
    renderScope();

    await waitFor(() => expect(trigger()).toHaveAccessibleName("label: Acme"));
    expect(trigger()).toHaveTextContent("Acme");
  });

  it("badges a Closed project the menu does not list", async () => {
    mocks.fetch.mockImplementation(closedScopeProjectResponse);
    mocks.search = "projectId=p-1";
    renderScope();

    await waitFor(() =>
      expect(trigger()).toHaveAccessibleName("label: Acme, closed"),
    );
    expect(screen.getByTestId("project-scope-closed-badge")).toHaveTextContent(
      "closed",
    );
  });

  it("badges nothing for an open project", async () => {
    mocks.search = "projectId=p-1";
    renderScope();

    await waitFor(() => expect(trigger()).toHaveAccessibleName("label: Acme"));
    expect(screen.queryByTestId("project-scope-closed-badge")).toBeNull();
  });

  it("shows no clear button when no project is picked", () => {
    renderScope();

    expect(
      screen.queryByRole("button", { name: "clearProject" }),
    ).not.toBeInTheDocument();
  });

  it("clears the picked project back to All projects", async () => {
    const user = userEvent.setup();
    mocks.search = "projectId=p-1";
    renderScope();

    await user.click(screen.getByRole("button", { name: "clearProject" }));

    expect(mocks.push).toHaveBeenCalledExactlyOnceWith("/tasks");
    expect(trigger()).toHaveFocus();
  });

  it("clears a remembered project on a page without its own scope", async () => {
    const user = userEvent.setup();
    const storageKey = JSON.stringify([
      "sokosumi.project-scope.v1",
      "user-1",
      "org-1",
    ]);
    mocks.pathname = "/chat";
    sessionStorage.setItem(storageKey, "p-1");
    renderScope();

    await user.click(screen.getByRole("button", { name: "clearProject" }));

    expect(sessionStorage.getItem(storageKey)).toBeNull();
    expect(trigger()).toHaveTextContent("allProjects");
    expect(trigger()).toHaveFocus();
    expect(
      screen.queryByRole("button", { name: "clearProject" }),
    ).not.toBeInTheDocument();
    expect(mocks.push).toHaveBeenCalledExactlyOnceWith("/chat");
  });

  it("shows the up/down chevron after the name", () => {
    renderScope();

    const chevron = trigger().querySelector("svg.lucide-chevrons-up-down");
    if (!chevron) throw new Error("no chevron");
    expect(
      trigger().firstElementChild?.compareDocumentPosition(chevron),
    ).toBeTruthy();
  });

  it("opens the Create dialog from the popover", async () => {
    const user = userEvent.setup();
    renderScope();

    await user.click(trigger());
    await user.click(await screen.findByTestId("project-scope-create"));

    expect(
      screen.queryByRole("dialog", { name: "switchLabel" }),
    ).not.toBeInTheDocument();
  });

  it("closes the popover and navigates when a project is picked", async () => {
    const user = userEvent.setup();
    mocks.loadPinned.mockResolvedValue([
      { id: "p-2", name: "Beta", logo: null, closedAt: null },
    ]);
    renderScope();

    await user.click(trigger());
    expect(
      await screen.findByRole("dialog", { name: "switchLabel" }),
    ).toBeInTheDocument();
    await user.click(await screen.findByTestId("project-scope-item-p-2"));

    expect(mocks.push).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "switchLabel" }),
      ).not.toBeInTheDocument(),
    );
  });
});
