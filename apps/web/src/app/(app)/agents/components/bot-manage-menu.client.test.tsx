import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { toggleMock } = vi.hoisted(() => ({ toggleMock: vi.fn() }));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));
vi.mock("@/app/soko-bots/components/pause-soko-bot-button.client", () => ({
  usePauseSokoBot: () => ({ toggle: toggleMock, pending: false }),
}));
vi.mock(
  "@/app/personal-assistant/components/archive-soko-bot-button.client",
  () => ({
    ArchiveSokoBotDialog: ({ open }: { open: boolean }) =>
      open ? <div role="alertdialog">archive dialog</div> : null,
  }),
);
// Radix menus open on pointer events happy-dom doesn't send; render flat.
vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: ReactNode }) => <>{children}</>,
  DropdownMenuTrigger: ({ children }: { children: ReactNode }) => (
    <>{children}</>
  ),
  DropdownMenuContent: ({ children }: { children: ReactNode }) => (
    <div role="menu">{children}</div>
  ),
  DropdownMenuItem: ({
    children,
    onSelect,
    asChild,
  }: {
    children: ReactNode;
    onSelect?: () => void;
    asChild?: boolean;
  }) =>
    asChild ? (
      children
    ) : (
      <button type="button" role="menuitem" onClick={onSelect}>
        {children}
      </button>
    ),
}));

import { BotManageMenu } from "./bot-manage-menu.client";

const base = {
  name: "Atlas",
  settingsHref: "/soko-bots/atlas",
  botId: "atlas",
};

describe("BotManageMenu", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("offers Settings, Pause and Archive to a manager", () => {
    render(<BotManageMenu {...base} paused={false} canArchive />);
    expect(screen.getByRole("link", { name: /settings/ })).toHaveAttribute(
      "href",
      "/soko-bots/atlas",
    );
    fireEvent.click(screen.getByRole("menuitem", { name: /pause/ }));
    expect(toggleMock).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("menuitem", { name: /Archive.archive/ }));
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
  });

  it("offers Resume on a paused bot and no Archive to a member", () => {
    render(<BotManageMenu {...base} paused canArchive={false} />);
    expect(
      screen.getByRole("menuitem", { name: /resume/ }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("menuitem", { name: /Archive.archive/ }),
    ).not.toBeInTheDocument();
  });

  it("gives Cuso Settings only", () => {
    render(<BotManageMenu {...base} paused={null} canArchive={false} />);
    expect(screen.getByRole("link", { name: /settings/ })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem")).not.toBeInTheDocument();
  });
});
