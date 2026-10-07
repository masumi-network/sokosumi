import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import messages from "@/../messages/en.json";

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  scrollNext: vi.fn(),
  scrollPrev: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push }),
}));
vi.mock("@/app/components/project-scope/use-project-scope", () => ({
  useProjectScope: () => ({
    projectId: null,
    switchHref: (id: string) => `/social?projectId=${id}`,
  }),
}));
vi.mock("@/app/components/project-scope/use-scope-projects", () => ({
  useScopeProjects: () => ({
    pinned: [],
    recent: [],
    all: [{ id: "marketing", name: "Marketing", logo: null }],
    isSearching: false,
    isPending: false,
    isSearchPending: false,
    isError: false,
    hasMore: false,
  }),
}));
vi.mock("@/app/projects/components/project-avatar", () => ({
  ProjectAvatar: () => <span aria-hidden />,
}));
vi.mock("embla-carousel-react", () => {
  const carousel = [
    vi.fn(),
    {
      canScrollPrev: () => true,
      canScrollNext: () => true,
      scrollPrev: mocks.scrollPrev,
      scrollNext: mocks.scrollNext,
      on: vi.fn(),
      off: vi.fn(),
    },
  ];
  return { default: () => carousel };
});

import { SocialAccountsProjectPrompt } from "./social-accounts-project-prompt";

function setup(props: Parameters<typeof SocialAccountsProjectPrompt>[0] = {}) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <SocialAccountsProjectPrompt {...props} />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => vi.clearAllMocks());

describe("SocialAccountsProjectPrompt", () => {
  it("chooses a real project and opens its Accounts tab", async () => {
    const user = userEvent.setup();
    setup();

    await user.click(screen.getByRole("button", { name: "Choose a project" }));
    expect(screen.getByRole("combobox")).toHaveFocus();
    expect(screen.queryByTestId("project-scope-workspace")).toBeNull();
    await user.click(screen.getByRole("option", { name: "Marketing" }));

    expect(mocks.push).toHaveBeenCalledWith(
      "/social?projectId=marketing&tab=accounts",
    );
    expect(screen.queryByRole("combobox")).toBeNull();
  });

  it("shows platforms without arrow buttons and supports keyboard scrolling", async () => {
    const user = userEvent.setup();
    setup();
    const carousel = screen.getByRole("region", { name: "Social platforms" });
    expect(
      carousel.querySelectorAll('[data-slot="carousel-item"]'),
    ).toHaveLength(6);
    expect(screen.getByText("TikTok")).toBeVisible();
    expect(screen.getByText("Coming soon")).toBeVisible();

    expect(screen.queryByRole("button", { name: "Next platforms" })).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Previous platforms" }),
    ).toBeNull();
    await user.click(carousel);
    expect(carousel).toHaveFocus();
    await user.keyboard("{ArrowRight}");
    expect(mocks.scrollNext).toHaveBeenCalledTimes(1);
    await user.keyboard("{ArrowLeft}");
    expect(mocks.scrollPrev).toHaveBeenCalledTimes(1);
  });

  it("keeps Drafts as the destination and hides the account carousel", async () => {
    const user = userEvent.setup();
    setup({ kind: "drafts" });
    expect(
      screen.queryByRole("region", { name: "Social platforms" }),
    ).toBeNull();
    await user.click(screen.getByRole("button", { name: "Choose a project" }));
    await user.click(screen.getByRole("option", { name: "Marketing" }));
    expect(mocks.push).toHaveBeenCalledWith(
      "/social?projectId=marketing&tab=drafts",
    );
  });

  it("keeps an unavailable-project notice and provides a replacement picker", () => {
    setup({
      notice: "That project is no longer available. Choose another project.",
    });
    expect(
      screen.getByText(/That project is no longer available/),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Choose a project" }),
    ).toBeVisible();
  });
});
