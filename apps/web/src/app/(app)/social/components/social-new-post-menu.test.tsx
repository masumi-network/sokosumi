import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import messages from "@/../messages/en.json";

const mocks = vi.hoisted(() => ({
  setOpen: vi.fn(),
  push: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push }),
}));

vi.mock("./social-compose-context", () => ({
  useSocialCompose: () => ({ open: false, setOpen: mocks.setOpen }),
}));

vi.mock("@/app/chat/actions", () => ({
  ensureSokoBotDirectRoomAction: vi.fn(),
}));

vi.mock("@/app/components/project-scope/project-scope-menu", () => ({
  ProjectScopeMenu: () => <div data-testid="project-scope-menu" />,
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

beforeEach(() => vi.clearAllMocks());

describe("SocialNewPostMenu", () => {
  it("gives New post a 40px desktop target and 44px menu rows", async () => {
    const user = userEvent.setup();
    setup();

    const trigger = screen.getByRole("button", { name: "New post" });
    expect(trigger).toHaveClass("size-14", "md:h-10");

    await user.click(trigger);
    expect(screen.getByRole("menuitem", { name: /Manual post/ })).toHaveClass(
      "min-h-11",
    );
    expect(
      screen.getByRole("menuitem", { name: /Post with Soko Bot/ }),
    ).toHaveClass("min-h-11");
  });
});
