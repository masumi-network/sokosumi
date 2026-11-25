import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { Sheet } from "@/components/ui/sheet";
import { SidebarProvider, useSidebar } from "@/components/ui/sidebar";
import { GlobalRail } from "./global-rail.client";
import {
  SidebarContextPanel,
  SidebarPanelProvider,
  useSidebarPanel,
} from "./sidebar-context-panel";

let pathname = "/chat/rooms/test";
let mobile = false;

vi.mock("next/navigation", () => ({ usePathname: () => pathname }));
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/hooks/effects/use-mobile", () => ({ useIsMobile: () => mobile }));
vi.mock("@/app/chat/components/use-chat-tab-unread-presence", () => ({
  useChatTabUnreadPresence: () => ({ showUnreadDot: false }),
}));

function Shell() {
  const { open, openMobile, setOpenMobile } = useSidebar();
  const { section } = useSidebarPanel();

  return (
    <>
      <button type="button" onClick={() => setOpenMobile(true)}>
        Open drawer
      </button>
      <output>{open || openMobile ? "open" : "closed"}</output>
      <Sheet>
        <GlobalRail mobile={mobile} />
      </Sheet>
      <SidebarContextPanel chats={<p>Room list</p>}>
        <p>{section} links</p>
      </SidebarContextPanel>
      <textarea aria-label="Composer" defaultValue="Unsent message" />
    </>
  );
}

function Fixture() {
  return (
    <SidebarProvider defaultOpen={false}>
      <SidebarPanelProvider>
        <Shell />
      </SidebarPanelProvider>
    </SidebarProvider>
  );
}

it("opens a collapsed panel and preserves the draft until the route changes", () => {
  const { rerender } = render(<Fixture />);
  const composer = screen.getByRole("textbox", { name: "Composer" });
  const marketing = screen.getByRole("button", { name: "groups.marketing" });
  expect(screen.getByRole("status")).toHaveTextContent("closed");

  fireEvent.click(marketing);
  expect(screen.getByRole("status")).toHaveTextContent("open");
  expect(marketing).toHaveAttribute("aria-pressed", "true");
  expect(marketing).not.toHaveAttribute("aria-current");
  expect(screen.getByText("marketing links")).toBeVisible();
  expect(screen.getByText("Room list")).not.toBeVisible();
  expect(screen.getByRole("textbox", { name: "Composer" })).toBe(composer);
  expect(composer).toHaveValue("Unsent message");

  pathname = "/social";
  rerender(<Fixture />);
  pathname = "/chat/rooms/test";
  rerender(<Fixture />);
  expect(marketing).toHaveAttribute("aria-pressed", "false");
  expect(screen.getByText("Room list")).toBeVisible();
});

it("keeps the mobile drawer open across section selections", () => {
  mobile = true;
  render(<Fixture />);
  fireEvent.click(screen.getByRole("button", { name: "Open drawer" }));
  fireEvent.click(screen.getByRole("button", { name: "groups.marketing" }));
  expect(screen.getByRole("status")).toHaveTextContent("open");
  fireEvent.click(screen.getByRole("button", { name: "chats" }));
  expect(screen.getByRole("status")).toHaveTextContent("open");
  expect(screen.getByText("Room list")).toBeVisible();
});
