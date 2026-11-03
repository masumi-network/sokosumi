import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import messages from "@/../messages/en.json";

const mocks = vi.hoisted(() => ({
  setOpen: vi.fn(),
  push: vi.fn(),
  compose: { open: false, scheduledAt: null as string | null },
  openProjectScope: vi.fn(),
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

vi.mock("@/app/components/project-scope/sidebar-project-scope-state", () => ({
  openProjectScope: mocks.openProjectScope,
}));

/** What the menu asked the header's project selector for, most recently. */
function lastRequest(): {
  required?: boolean;
  reason?: string;
  onSelect?: (projectId: string) => void;
  onDismiss?: () => void;
} {
  const request = mocks.openProjectScope.mock.lastCall?.[0];
  if (!request) throw new Error("The project selector was not opened");
  return request;
}

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

  it("turns a calendar day's request into a project pick that keeps the day", () => {
    mocks.compose = { open: true, scheduledAt: "2030-01-16T09:00" };
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <SocialNewPostMenu project={null} sokoBotId="bot-1" />
      </NextIntlClientProvider>,
    );

    expect(mocks.openProjectScope).toHaveBeenCalledOnce();
    expect(lastRequest()).toMatchObject({
      required: true,
      reason: "Posts go out from one project's accounts.",
    });
    lastRequest().onSelect?.("p2");
    expect(mocks.push).toHaveBeenCalledWith(
      "/social?projectId=p2&compose=new&composeAt=2030-01-16T09%3A00",
    );

    // Closing the selector without a project drops the composer request.
    lastRequest().onDismiss?.();
    expect(mocks.setOpen).toHaveBeenCalledWith(false);
  });

  it("asks for a project through the composer request when none is in scope", async () => {
    const user = userEvent.setup();
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <SocialNewPostMenu project={null} sokoBotId="bot-1" />
      </NextIntlClientProvider>,
    );
    expect(mocks.openProjectScope).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "New post" }));
    await user.click(screen.getByRole("menuitem", { name: /Manual post/ }));
    expect(mocks.setOpen).toHaveBeenCalledWith(true);
  });
});
