import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import messages from "@/../messages/en.json";

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  openProjectScope: vi.fn(),
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
  usePrefetchScopeProjects: () => () => undefined,
}));
vi.mock("@/app/components/project-scope/sidebar-project-scope-state", () => ({
  openProjectScope: mocks.openProjectScope,
}));

/** What the prompt asked the header's selector for, most recently. */
function lastRequest(): {
  required?: boolean;
  reason?: string;
  onSelect?: (projectId: string) => void;
} {
  const request = mocks.openProjectScope.mock.lastCall?.[0];
  if (!request) throw new Error("The project selector was not opened");
  return request;
}

import { SocialAccountsProjectPrompt } from "./social-accounts-project-prompt";

function setup(props: Parameters<typeof SocialAccountsProjectPrompt>[0] = {}) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <SocialAccountsProjectPrompt {...props} />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("SocialAccountsProjectPrompt", () => {
  it("asks to choose a project before connecting", () => {
    setup();
    expect(
      screen.getByRole("heading", { name: "Choose a project" }),
    ).toBeVisible();
    expect(screen.getByText("Then connect accounts.")).toBeVisible();
  });

  it("opens the header's selector, required, on arrival", () => {
    setup();
    expect(mocks.openProjectScope).toHaveBeenCalledOnce();
    expect(lastRequest()).toMatchObject({
      required: true,
      reason: "Then connect accounts.",
    });
  });

  it("does not open the selector on arrival when told not to", () => {
    setup({ autoOpen: false });
    expect(mocks.openProjectScope).not.toHaveBeenCalled();
  });

  it("chooses a real project in the header's selector and opens its Accounts tab", async () => {
    const user = userEvent.setup();
    setup({ autoOpen: false });

    await user.click(screen.getByRole("button", { name: "Choose a project" }));
    expect(lastRequest().required).toBe(true);
    lastRequest().onSelect?.("marketing");

    expect(mocks.push).toHaveBeenCalledWith(
      "/social?projectId=marketing&tab=accounts",
    );
    // No list of its own: the header's selector is the only one.
    expect(screen.queryByRole("combobox")).toBeNull();
  });

  it("uses the shared project placeholder, with no platform carousel", () => {
    setup();
    expect(screen.getByTestId("social-no-project")).toBeVisible();
    expect(screen.queryByRole("region")).toBeNull();
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("keeps Drafts as the destination", async () => {
    const user = userEvent.setup();
    setup({ kind: "drafts" });
    await user.click(screen.getByRole("button", { name: "Choose a project" }));
    lastRequest().onSelect?.("marketing");
    expect(mocks.push).toHaveBeenCalledWith(
      "/social?projectId=marketing&tab=drafts",
    );
  });

  it("keeps Needs attention as the destination", async () => {
    const user = userEvent.setup();
    setup({ kind: "attention" });
    expect(
      screen.getByRole("heading", { name: "Needs attention" }),
    ).toBeVisible();
    expect(
      screen.getByText(
        "Choose a project to see posts that failed or were missed.",
      ),
    ).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Choose a project" }));
    lastRequest().onSelect?.("marketing");
    expect(mocks.push).toHaveBeenCalledWith(
      "/social?projectId=marketing&tab=attention",
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
    expect(lastRequest().reason).toBe(
      "That project is no longer available. Choose another project.",
    );
  });
});
