import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import messages from "@/../messages/en.json";

const mocks = vi.hoisted(() => ({
  setOpen: vi.fn(),
  push: vi.fn(),
  compose: { open: false, scheduledAt: null as Date | null },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push }),
}));

vi.mock("./social-compose-context", () => ({
  useSocialCompose: () => ({ ...mocks.compose, setOpen: mocks.setOpen }),
}));

vi.mock("@/app/chat/actions", () => ({
  ensureSokoBotDirectRoomAction: vi.fn(),
}));

vi.mock("@/app/components/project-scope/project-scope-menu", () => ({
  ProjectScopeMenu: ({ onSelect }: { onSelect: (id: string) => void }) => (
    <button
      data-testid="project-scope-menu"
      onClick={() => onSelect("p2")}
      type="button"
    >
      Pick p2
    </button>
  ),
}));

import { SocialNewPostMenu } from "./social-new-post-menu";

function setup() {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <SocialNewPostMenu
        project={{ id: "p1", name: "Launch" }}
        sokoBotId="bot-1"
      />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.compose = { open: false, scheduledAt: null };
});

describe("SocialNewPostMenu", () => {
  it("gives New post a 40px desktop target and 44px menu rows", async () => {
    const user = userEvent.setup();
    setup();

    const trigger = screen.getByRole("button", { name: "New post" });
    expect(trigger).toHaveClass("h-11", "shrink-0", "md:h-10");
    expect(trigger).not.toHaveClass("size-14");

    await user.click(trigger);
    expect(screen.getByRole("menuitem", { name: /Manual post/ })).toHaveClass(
      "min-h-11",
    );
    expect(
      screen.getByRole("menuitem", { name: /Post with Soko Bot/ }),
    ).toHaveClass("min-h-11");
  });

  it("asks for a project for a post the calendar started, and keeps its time", async () => {
    const user = userEvent.setup();
    mocks.compose = {
      open: true,
      scheduledAt: new Date("2030-01-03T09:00:00.000Z"),
    };
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <SocialNewPostMenu project={null} sokoBotId="bot-1" />
      </NextIntlClientProvider>,
    );

    expect(
      screen.getByRole("dialog", { name: "Choose a project for this post" }),
    ).toBeInTheDocument();
    await user.click(screen.getByTestId("project-scope-menu"));

    expect(mocks.push).toHaveBeenCalledWith(
      "/social?projectId=p2&compose=new&composeAt=2030-01-03T09%3A00%3A00.000Z",
    );
  });
});
