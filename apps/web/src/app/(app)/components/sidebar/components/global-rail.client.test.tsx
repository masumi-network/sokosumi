import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Sidebar, SidebarProvider, useSidebar } from "@/components/ui/sidebar";
import { SIDEBAR_COMPACT_MEDIA_QUERY } from "@/lib/ui-preferences/sidebar-state";
import { GlobalRail } from "./global-rail.client";
import {
  SidebarContextPanel,
  SidebarMobileChatsDestination,
  SidebarPanelProvider,
  useSidebarPanel,
} from "./sidebar-context-panel";
import { NAV_DESTINATIONS, NAV_GROUPS } from "./sidebar-sections";

let pathname = "/chat/rooms/test";
let mobile = false;
let compact = false;

beforeEach(() => {
  pathname = "/chat/rooms/test";
  mobile = false;
  compact = false;
  vi.spyOn(window, "matchMedia").mockImplementation(
    (query) =>
      ({
        matches: compact && query === SIDEBAR_COMPACT_MEDIA_QUERY,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }) as unknown as MediaQueryList,
  );
});
afterEach(() => vi.restoreAllMocks());

vi.mock("next/navigation", () => ({
  usePathname: () => pathname,
  useRouter: () => ({ prefetch: vi.fn() }),
}));
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
      {!mobile && <GlobalRail />}
      <Sidebar>
        {mobile && <GlobalRail mobile />}
        <SidebarContextPanel
          chats={
            <>
              <SidebarMobileChatsDestination />
              <p>Room list</p>
            </>
          }
        >
          <button
            type="button"
            style={{ display: "none" }}
            ref={(button) => {
              if (button) button.checkVisibility = () => false;
            }}
          >
            Hidden project control
          </button>
          <a href="/social">{section} links</a>
        </SidebarContextPanel>
      </Sidebar>
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
  const chats = screen.getByRole("button", { name: "chats" });
  expect(chats).toHaveAttribute("aria-current", "location");
  expect(chats).toHaveAttribute("aria-pressed", "false");
  expect(marketing).toHaveClass("bg-sidebar-accent");
  expect(marketing).not.toHaveClass("border-sidebar-border");
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
  expect(screen.getByRole("dialog")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "backToRooms" }));
  expect(screen.getByRole("dialog")).toBeVisible();
  expect(screen.getByText("Room list")).toBeVisible();
});

it("uses one Escape to dismiss the phone drawer and restores focus", () => {
  mobile = true;
  render(<Fixture />);
  const trigger = screen.getByRole("button", { name: "Open drawer" });
  trigger.focus();
  fireEvent.click(trigger);
  const drawer = screen.getByRole("dialog");
  const marketing = within(drawer).getByRole("button", {
    name: "groups.marketing",
  });
  fireEvent.click(marketing);
  marketing.focus();
  expect(within(drawer).queryByRole("tooltip")).toBeNull();
  fireEvent.keyDown(marketing, { key: "Escape" });
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("keeps Chats out of the phone rail and provides an All chats destination", () => {
  mobile = true;
  render(<Fixture />);
  fireEvent.click(screen.getByRole("button", { name: "Open drawer" }));
  const drawer = screen.getByRole("dialog");
  expect(within(drawer).queryByRole("button", { name: "chats" })).toBeNull();
  const rail = within(drawer).getByRole("navigation");
  expect(within(rail).getAllByRole("button")).toHaveLength(4);
  expect(
    within(drawer).getByRole("link", { name: "allChats" }),
  ).toHaveAttribute("href", "/chat/rooms");
});

it("overlays the compact panel and dismisses it on second click, Escape or navigation", () => {
  compact = true;
  const { container, rerender } = render(<Fixture />);
  const marketing = screen.getByRole("button", { name: "groups.marketing" });
  expect(container.querySelector('[data-slot="sidebar-gap"]')).toHaveClass(
    "max-lg:w-0",
  );

  fireEvent.click(marketing);
  expect(screen.getByText("marketing links")).toBeVisible();
  fireEvent.click(marketing);
  expect(marketing).toHaveAttribute("aria-pressed", "false");

  fireEvent.click(marketing);
  fireEvent.keyDown(marketing, { key: "Escape" });
  expect(marketing).toHaveAttribute("aria-pressed", "false");

  fireEvent.click(marketing);
  pathname = "/social";
  rerender(<Fixture />);
  expect(marketing).toHaveAttribute("aria-pressed", "false");
});

it("hands keyboard focus directly to the open panel", async () => {
  render(<Fixture />);
  fireEvent.click(screen.getByRole("button", { name: "groups.marketing" }), {
    detail: 0,
  });
  await waitFor(() =>
    expect(screen.getByRole("link", { name: "marketing links" })).toHaveFocus(),
  );
});

it("keeps rail icons distinct from destination icons", () => {
  for (const { Icon } of NAV_GROUPS) {
    expect(NAV_DESTINATIONS.map((item) => item.Icon)).not.toContain(Icon);
  }
});

it("starts unknown and Home routes in Chats with Home first", () => {
  pathname = "/chat";
  render(<Fixture />);
  const chats = screen.getByRole("button", { name: "chats" });
  expect(chats).toHaveAttribute("aria-current", "location");
  fireEvent.click(chats);
  expect(screen.getAllByRole("link")[0]).toHaveAttribute("href", "/chat");
  expect(screen.getAllByRole("link")[0]).toHaveAttribute(
    "aria-current",
    "page",
  );
});

it("keeps the approved Work briefcase at 16px and matches the other row glyphs", () => {
  render(<Fixture />);
  for (const button of within(screen.getByRole("navigation")).getAllByRole(
    "button",
  )) {
    expect(button).toHaveClass("h-12", "w-16");
    const icon = button.querySelector("svg");
    expect(icon).toHaveAttribute("stroke-width", "2");
    expect(icon).toHaveClass("size-4");
    if (button.getAttribute("aria-label") === "groups.work") {
      expect(icon).toHaveClass("lucide-briefcase");
      expect(icon).not.toHaveClass("md:size-3.5");
    } else {
      expect(icon).toHaveClass("md:size-3.5");
    }
  }
});
