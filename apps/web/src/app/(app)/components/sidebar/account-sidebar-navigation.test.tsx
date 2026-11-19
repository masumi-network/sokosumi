import type { SidebarLayout } from "@sokosumi/core-client";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { expect, it, vi } from "vitest";
import { SidebarChatContext } from "@/components/chat/sidebar-chat-entries";
import { Sheet } from "@/components/ui/sheet";
import { SidebarProvider } from "@/components/ui/sidebar";
import { TestQueryProvider } from "@/test/query-provider";
import messages from "../../../../../messages/en.json";
import { AccountSidebarNavigation } from "./account-sidebar-navigation";

const network = vi.hoisted(() => ({
  read: vi.fn(),
  write: vi.fn(),
}));
vi.mock("@/lib/clients/core.preferences.browser.client", () => ({
  preferencesBrowserClient: {
    getMyPreferences: network.read,
    patchMyPreferences: network.write,
  },
}));
vi.mock("@/lib/auth/auth.client", () => ({
  useSession: () => ({ data: null, isPending: false }),
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ prefetch: () => undefined }),
}));

const custom: SidebarLayout = {
  sections: [
    { id: "desk", name: "My desk", items: ["channels", "social"] },
    { id: "quiet", name: "Quiet", items: ["pinned"] },
  ],
  hidden: [],
};

function navigation(userId: string, activity: string | null) {
  return (
    <TestQueryProvider>
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <SidebarProvider>
          <Sheet>
            <SidebarChatContext
              value={{
                entries: {
                  "catch-up": null,
                  pinned: null,
                  channels: activity ? <span>{activity}</span> : null,
                  external: null,
                  archived: null,
                  "direct-messages": null,
                },
                controls: {
                  attentionFor: () => null,
                  actions: <button type="button">Unreads</button>,
                },
              }}
            >
              <AccountSidebarNavigation
                key={userId}
                userId={userId}
                hasOrganization
                newsletterEnabled={false}
              />
            </SidebarChatContext>
          </Sheet>
        </SidebarProvider>
      </NextIntlClientProvider>
    </TestQueryProvider>
  );
}

it("keeps chat previews live, stages reset, and restores the saved layout only for its account", async () => {
  let stored: SidebarLayout | null = custom;
  network.read.mockImplementation(async () => ({
    data: { sidebarLayout: stored },
  }));
  network.write.mockImplementation(
    async ({ sidebarLayout }: { sidebarLayout: SidebarLayout | null }) => {
      stored = sidebarLayout;
      return { data: { sidebarLayout } };
    },
  );
  const view = render(navigation("first", "Design channel"));
  await screen.findByRole("button", { name: "My desk" });
  expect(screen.queryByRole("button", { name: "Quiet" })).toBeNull();
  expect(screen.getByText("Design channel")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Edit sidebar" }));
  view.rerender(navigation("first", "Design channel, unread"));
  expect(screen.getByText("Design channel, unread")).toBeVisible();
  expect(screen.getByRole("button", { name: "Reorder Quiet" })).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Reset to default" }));
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(screen.getByRole("button", { name: "My desk" })).toBeVisible();
  expect(network.write).not.toHaveBeenCalled();

  fireEvent.click(screen.getByRole("button", { name: "Edit sidebar" }));
  fireEvent.click(screen.getByRole("button", { name: "Reset to default" }));
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() =>
    expect(screen.queryByRole("button", { name: "My desk" })).toBeNull(),
  );
  await screen.findByRole("button", { name: "Work" });
  expect(stored).toBeNull();

  network.read.mockResolvedValue({ data: { sidebarLayout: custom } });
  view.rerender(navigation("second", "Second account's room"));
  await screen.findByRole("button", { name: "My desk" });
  expect(screen.getByText("Second account's room")).toBeVisible();
  expect(screen.queryByText("Design channel, unread")).toBeNull();
});

// With Catch up hidden, the Unreads filter may hide the only visible chat list.
it("keeps the filter reachable when the last configured chat entry empties", async () => {
  network.read.mockResolvedValue({
    data: {
      sidebarLayout: {
        sections: [{ id: "desk", name: "Channels only", items: ["channels"] }],
        hidden: [],
      },
    },
  });
  const view = render(navigation("solo", "An unread room"));
  await screen.findByRole("button", { name: "Channels only" });
  view.rerender(navigation("solo", null));
  expect(screen.queryByRole("button", { name: "Channels only" })).toBeNull();
  expect(screen.getByRole("button", { name: "Unreads" })).toBeVisible();
});

// Work, Records and Marketing read as inside the project; the chat
// sections are the workspace's, so they sit outside the line.
// The chat area is headed like the nav groups (its Chats heading lives in
// the list), so no rule cuts the sidebar in two between them.
it("keeps the default feature groups under the project and chats outside them", async () => {
  network.read.mockResolvedValue({ data: { sidebarLayout: null } });
  const { container } = render(navigation("default", "Design channel"));
  const work = await screen.findByRole("button", { name: "Work" });
  const marketing = screen.getByRole("button", { name: "Marketing" });
  const chats = screen.getByRole("button", { name: "Chats" });
  const line = '[class~="max-md:border-s"]';
  expect(work.closest(line)).not.toBeNull();
  expect(marketing.closest(line)?.nextElementSibling?.contains(chats)).toBe(
    true,
  );
  expect(chats.closest(line)).toBeNull();
  expect(container.querySelector('[data-slot="sidebar-separator"]')).toBeNull();
});
