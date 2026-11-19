import { act, fireEvent, screen } from "@testing-library/react";
import { beforeEach, expect, it } from "vitest";
import { notifyOrganizationChatRoomsChanged } from "@/components/chat/organization-chat-events";
import {
  type SidebarChatEntryId,
  useSidebarChatControls,
  useSidebarChatEntries,
} from "@/components/chat/sidebar-chat-entries";
import { serializeChatUnreadsFilterCookie } from "@/lib/ui-preferences/chat-unreads-filter";
import {
  createOrganizationChatList,
  emptyListResult,
  listRoomsMock,
  makeInvitation,
  makeRoom,
  renderOrganizationChatList,
  resetOrganizationChatListMocks,
} from "./organization-chat-list-harness";

function Entries({ order }: { order: SidebarChatEntryId[] }) {
  const entries = useSidebarChatEntries(order.includes("catch-up"));
  return order.map((id) =>
    entries[id] ? (
      <section aria-label={id} key={id}>
        {entries[id]}
      </section>
    ) : null,
  );
}

beforeEach(resetOrganizationChatListMocks);

it("keeps the same room feed when chat entries change position", async () => {
  const rooms = [
    makeRoom({ id: "Release", kind: "channel", myAccess: "member" }),
  ];
  listRoomsMock.mockResolvedValue(emptyListResult(rooms));
  const initial = {
    rooms,
    children: <Entries order={["channels", "catch-up"]} />,
  };
  const view = renderOrganizationChatList(initial);
  expect(
    screen.getAllByRole("region").map((el) => el.getAttribute("aria-label")),
  ).toEqual(["channels", "catch-up"]);
  await screen.findByText("Release");
  view.rerender(
    createOrganizationChatList({
      ...initial,
      children: <Entries order={["catch-up", "channels"]} />,
    }),
  );
  expect(
    screen.getAllByRole("region").map((el) => el.getAttribute("aria-label")),
  ).toEqual(["catch-up", "channels"]);
  act(() => notifyOrganizationChatRoomsChanged({ removedRoomId: "Release" }));
  expect(screen.queryByRole("region", { name: "channels" })).toBeNull();
  act(() =>
    notifyOrganizationChatRoomsChanged({
      room: makeRoom({ id: "Roadmap", kind: "channel", myAccess: "member" }),
    }),
  );
  expect(screen.getByRole("region", { name: "channels" })).toHaveTextContent(
    "Roadmap",
  );
  expect(listRoomsMock).toHaveBeenCalledTimes(1);
});

it("suppresses unfiltered room previews during hydration when the boot script found Unreads", () => {
  renderOrganizationChatList({
    paintOnly: true,
    rooms: [makeRoom({ id: "News", kind: "channel", myAccess: "member" })],
    children: <Entries order={["channels", "catch-up"]} />,
  });
  const guard = '[class~="chat-unreads-boot:hidden"]';
  expect(screen.getByText("News").closest(guard)).not.toBeNull();
  expect(
    screen.getByRole("region", { name: "catch-up" }).closest(guard),
  ).toBeNull();
});

it("keeps a pending invitation visible in a personal workspace with no rooms", () => {
  renderOrganizationChatList({
    paintOnly: true,
    organizationId: null,
    pendingInvitations: [makeInvitation()],
    children: (
      <Entries
        order={[
          "channels",
          "external",
          "direct-messages",
          "archived",
          "pinned",
        ]}
      />
    ),
  });
  expect(
    screen.getAllByRole("region").map((el) => el.getAttribute("aria-label")),
  ).toEqual(["external"]);
  expect(screen.getByText("Partners")).toBeInTheDocument();
});

it("remembers a folded Channels list after turning Unreads on and off", () => {
  renderOrganizationChatList({
    paintOnly: true,
    rooms: [makeRoom({ id: "News", kind: "channel", myAccess: "member" })],
  });
  const channels = () =>
    screen.getByRole("button", { name: "App.Channels.title" });
  fireEvent.click(channels());
  expect(channels()).toHaveAttribute("aria-expanded", "false");
  const toggle = screen.getByRole("button", { name: "All unreads" });
  fireEvent.click(toggle);
  fireEvent.click(toggle);
  expect(channels()).toHaveAttribute("aria-expanded", "false");
});

it("keeps Unreads in the chosen chat categories when Catch up is hidden", () => {
  document.cookie = serializeChatUnreadsFilterCookie(true);
  renderOrganizationChatList({
    paintOnly: true,
    rooms: [
      makeRoom({
        id: "Launch",
        kind: "channel",
        myAccess: "member",
        unreadCount: 1,
      }),
      makeRoom({ id: "Quiet", kind: "channel", myAccess: "member" }),
      makeRoom({
        id: "Vendor",
        kind: "channel",
        myAccess: "guest",
        unreadCount: 1,
      }),
      makeRoom({
        id: "Private",
        kind: "direct",
        myAccess: "member",
        unreadCount: 1,
      }),
    ],
    pendingInvitations: [makeInvitation()],
    children: <Entries order={["external", "channels"]} />,
  });
  expect(screen.getByRole("region", { name: "channels" })).toHaveTextContent(
    "Launch",
  );
  const external = screen.getByRole("region", { name: "external" });
  expect(external).toHaveTextContent("Vendor");
  expect(external).toHaveTextContent("Partners");
  expect(screen.getAllByTestId("room-row")).toHaveLength(2);
  expect(screen.queryByText("Quiet")).toBeNull();
});

it("marks a folded section for the chat entries placed inside it", () => {
  function Headings() {
    const { attentionFor } = useSidebarChatControls();
    return (
      <>
        {[
          ["channels"],
          ["direct-messages"],
          ["pinned", "external"],
          ["catch-up"],
        ].map((ids) => (
          <output aria-label={ids.join(" ")} key={ids.join(" ")}>
            {attentionFor?.(ids) ?? "quiet"}
          </output>
        ))}
      </>
    );
  }
  renderOrganizationChatList({
    paintOnly: true,
    rooms: [
      makeRoom({
        id: "Announcements",
        kind: "channel",
        myAccess: "member",
        unreadCount: 1,
      }),
      makeRoom({
        id: "Discussion",
        kind: "direct",
        myAccess: "member",
        unreadThreadCount: 1,
        unreadThreadMentionCount: 1,
      }),
    ],
    pendingInvitations: [makeInvitation()],
    children: <Headings />,
  });
  expect(screen.getByLabelText("channels")).toHaveTextContent("unread");
  expect(screen.getByLabelText("direct-messages")).toHaveTextContent("quiet");
  expect(screen.getByLabelText("pinned external")).toHaveTextContent("mention");
  expect(screen.getByLabelText("catch-up")).toHaveTextContent("mention");
});
