import "./rooms-client-harness";
import type { ChatRoomMessage } from "@sokosumi/core-client";
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TestQueryProvider } from "@/test/query-provider";
import {
  PersistentRoomView,
  RoomRouteBootstrap,
} from "../persistent-room-view";
import { RoomCacheProvider } from "../room-cache-provider";
import {
  channelRoom,
  organization,
  roomsClientBaseProps,
  sampleMessage,
} from "./rooms-client-harness";

vi.mock("@/app/chat/components/room-search-panel", () => ({
  RoomSearchPanel: () => null,
}));
vi.mock("@/app/chat/components/unread-threads-panel", () => ({
  UnreadThreadsPanel: () => null,
}));
vi.mock("../room-file-drop-zone", () => ({
  RoomFileDropZone: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
}));
// An unsent draft lives in the composer's own state.
vi.mock("../room-session-composer", async () => {
  const { useState } = await import("react");
  return {
    RoomSessionComposer: () => {
      const [draft, setDraft] = useState("");
      return (
        <textarea
          aria-label="draft"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
      );
    },
  };
});
vi.mock("../room-message-row", () => ({
  ChatMessageRow: ({ message }: { message: ChatRoomMessage }) => (
    <div>{message.content}</div>
  ),
}));
vi.mock("../thread-panel", () => ({ ThreadPanel: () => null }));
vi.mock("../add-room-members-dialog", () => ({
  AddRoomMembersDialog: () => null,
}));

const personalDirect = channelRoom({
  organizationId: null,
  kind: "direct",
  discoverability: null,
  slug: null,
});
const externalChannel = channelRoom({ discoverability: "external" });
const orgChannel = channelRoom();

/** The app frame: the workspace comes from the session, the page from the last server render. */
function Frame({
  workspaceId,
  pageWorkspaceId,
  room,
}: {
  workspaceId: string;
  pageWorkspaceId: string;
  room: typeof orgChannel;
}) {
  return (
    <RoomCacheProvider currentUserId="user-1" workspaceId={workspaceId}>
      <PersistentRoomView>
        <RoomRouteBootstrap
          {...roomsClientBaseProps({
            loadHistoryOnClient: true,
            activeOrganization: { ...organization, id: pageWorkspaceId },
            rooms: [room],
          })}
        />
      </PersistentRoomView>
    </RoomCacheProvider>
  );
}

async function openThenSwitch(room: typeof orgChannel) {
  const view = render(
    <Frame workspaceId="org-1" pageWorkspaceId="org-1" room={room} />,
    { wrapper: TestQueryProvider },
  );
  expect(await screen.findByText("history row")).toBeTruthy();
  fireEvent.change(screen.getByLabelText("draft"), {
    target: { value: "half a thought" },
  });
  // The session lands on the new workspace before the refreshed page does.
  view.rerender(
    <Frame workspaceId="org-2" pageWorkspaceId="org-1" room={room} />,
  );
  await act(async () => {});
  return view;
}

describe("workspace switch with a room open", () => {
  beforeEach(() => {
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              data: [sampleMessage("history row")],
              meta: { pagination: { nextCursor: null } },
            }),
          ),
      ),
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each([
    ["a Personal Direct", personalDirect],
    ["a hosted External channel", externalChannel],
  ])("keeps %s open with its draft", async (_label, room) => {
    const view = await openThenSwitch(room);

    expect(screen.getByText("history row")).toBeTruthy();
    expect(screen.getByLabelText("draft")).toHaveValue("half a thought");

    view.rerender(
      <Frame workspaceId="org-2" pageWorkspaceId="org-2" room={room} />,
    );
    await act(async () => {});
    expect(screen.getByText("history row")).toBeTruthy();
    expect(screen.getByLabelText("draft")).toHaveValue("half a thought");
  });

  it("closes a Channel of the previous workspace, as before", async () => {
    await openThenSwitch(orgChannel);

    expect(screen.queryByText("history row")).toBeNull();
    expect(screen.queryByLabelText("draft")).toBeNull();
  });

  describe("on a Room visit", () => {
    async function openVisit() {
      // The room belongs to org-1; the reader is in org-2.
      const view = render(
        <Frame workspaceId="org-2" pageWorkspaceId="org-2" room={orgChannel} />,
        { wrapper: TestQueryProvider },
      );
      expect(await screen.findByText("history row")).toBeTruthy();
      fireEvent.change(screen.getByLabelText("draft"), {
        target: { value: "half a thought" },
      });
      return view;
    }

    it("opens without moving the workspace", async () => {
      await openVisit();

      expect(screen.getByText("history row")).toBeTruthy();
    });

    it("stays open with its draft on a switch to the room's workspace", async () => {
      const view = await openVisit();

      view.rerender(
        <Frame workspaceId="org-1" pageWorkspaceId="org-2" room={orgChannel} />,
      );
      await act(async () => {});
      expect(screen.getByText("history row")).toBeTruthy();
      expect(screen.getByLabelText("draft")).toHaveValue("half a thought");

      view.rerender(
        <Frame workspaceId="org-1" pageWorkspaceId="org-1" room={orgChannel} />,
      );
      await act(async () => {});
      expect(screen.getByText("history row")).toBeTruthy();
      expect(screen.getByLabelText("draft")).toHaveValue("half a thought");
    });

    it("closes on a switch to any other workspace", async () => {
      const view = await openVisit();

      view.rerender(
        <Frame workspaceId="org-3" pageWorkspaceId="org-2" room={orgChannel} />,
      );
      await act(async () => {});

      expect(screen.queryByText("history row")).toBeNull();
      expect(screen.queryByLabelText("draft")).toBeNull();
    });
  });
});
