import type { ChatRoom } from "@sokosumi/core-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SidebarChatListDeferred } from "./private-sidebar-cache";

interface ListProps {
  rooms: ChatRoom[];
  archivedRooms: ChatRoom[];
  isOrgOwnerOrAdmin?: boolean;
  withChatsHeading?: boolean;
  dismissSheetOnNavigate?: boolean;
}

const listRenders: ListProps[] = [];
let listMounts = 0;

// The list is the boundary: this file pins what the wrapper hands it and that
// it is mounted once.
vi.mock("@/components/chat/organization-chat-list.client", async () => {
  const { useEffect } = await import("react");
  return {
    OrganizationChatList: (props: ListProps) => {
      listRenders.push(props);
      useEffect(() => {
        listMounts += 1;
      }, []);
      return null;
    },
  };
});

import { SidebarChatList } from "./sidebar-chat-list.client";

const rooms = [{ id: "room-1" }] as ChatRoom[];
const archivedRooms = [{ id: "room-archived" }] as ChatRoom[];

function deferred() {
  let resolve: (value: SidebarChatListDeferred) => void = () => undefined;
  let reject: (reason: unknown) => void = () => undefined;
  const promise = new Promise<SidebarChatListDeferred>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function lastRender(): ListProps {
  const last = listRenders.at(-1);
  if (!last) throw new Error("the list never rendered");
  return last;
}

let queryClient: QueryClient;

function renderList(pending: Promise<SidebarChatListDeferred>) {
  return render(
    <QueryClientProvider client={queryClient}>
      <SidebarChatList
        rooms={rooms}
        deferred={pending}
        currentUserId="user-1"
        organizationId="org-1"
      />
    </QueryClientProvider>,
  );
}

describe("SidebarChatList", () => {
  beforeEach(() => {
    listRenders.length = 0;
    listMounts = 0;
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
  });

  it("shows the rooms before the archived rooms arrive, then fills them into the same mount", async () => {
    const admin = deferred();
    renderList(admin.promise);

    expect(lastRender()).toMatchObject({
      rooms,
      archivedRooms: [],
      isOrgOwnerOrAdmin: false,
    });

    await act(async () => {
      admin.resolve({ archivedRooms, isOrgOwnerOrAdmin: true });
    });

    await waitFor(() => {
      expect(lastRender()).toMatchObject({
        rooms,
        archivedRooms,
        isOrgOwnerOrAdmin: true,
      });
    });
    expect(listMounts).toBe(1);
  });

  it("hands the list one empty archive across renders, so it keeps its rows", () => {
    const admin = deferred();
    const view = renderList(admin.promise);
    view.rerender(
      <QueryClientProvider client={queryClient}>
        <SidebarChatList
          rooms={rooms}
          deferred={admin.promise}
          currentUserId="user-1"
          organizationId="org-1"
        />
      </QueryClientProvider>,
    );

    expect(listRenders.length).toBeGreaterThan(1);
    expect(lastRender().archivedRooms).toBe(listRenders[0]?.archivedRooms);
  });

  it("keeps what it shows while a refreshed read is pending, and ignores a read that was replaced", async () => {
    const first = deferred();
    const view = renderList(first.promise);
    await act(async () => {
      first.resolve({ archivedRooms, isOrgOwnerOrAdmin: true });
    });
    await waitFor(() => {
      expect(lastRender()).toMatchObject({
        archivedRooms,
        isOrgOwnerOrAdmin: true,
      });
    });
    const rerender = (pending: Promise<SidebarChatListDeferred>) =>
      view.rerender(
        <QueryClientProvider client={queryClient}>
          <SidebarChatList
            rooms={rooms}
            deferred={pending}
            currentUserId="user-1"
            organizationId="org-1"
          />
        </QueryClientProvider>,
      );

    const second = deferred();
    rerender(second.promise);
    expect(lastRender()).toMatchObject({
      archivedRooms,
      isOrgOwnerOrAdmin: true,
    });

    const third = deferred();
    rerender(third.promise);
    const newer = [{ id: "room-newer" }] as ChatRoom[];
    await act(async () => {
      third.resolve({ archivedRooms: newer, isOrgOwnerOrAdmin: true });
    });
    await waitFor(() => {
      expect(lastRender()).toMatchObject({
        archivedRooms: newer,
        isOrgOwnerOrAdmin: true,
      });
    });
    // The replaced read answers last.
    await act(async () => {
      second.resolve({ archivedRooms: [], isOrgOwnerOrAdmin: false });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(lastRender()).toMatchObject({
      archivedRooms: newer,
      isOrgOwnerOrAdmin: true,
    });
  });

  it("starts a list that mounts again with the answer it already has", async () => {
    const pending = deferred();
    const view = renderList(pending.promise);
    await act(async () => {
      pending.resolve({ archivedRooms, isOrgOwnerOrAdmin: true });
    });
    view.unmount();
    listRenders.length = 0;

    renderList(pending.promise);

    expect(listRenders[0]).toMatchObject({
      archivedRooms,
      isOrgOwnerOrAdmin: true,
    });
  });

  it("heads the sidebar's list with Chats and closes its sheet on navigate", () => {
    renderList(deferred().promise);

    expect(lastRender()).toMatchObject({
      withChatsHeading: true,
      dismissSheetOnNavigate: true,
    });
  });

  it("renders the phone Chats page's list without the heading and without a sheet to close", () => {
    render(
      <QueryClientProvider client={queryClient}>
        <SidebarChatList
          rooms={rooms}
          deferred={deferred().promise}
          currentUserId="user-1"
          organizationId="org-1"
          variant="page"
        />
      </QueryClientProvider>,
    );

    expect(lastRender()).toMatchObject({
      withChatsHeading: false,
      dismissSheetOnNavigate: false,
    });
  });

  it("keeps the rows when the answer fails", async () => {
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    try {
      const pending = deferred();
      renderList(pending.promise);

      await act(async () => {
        pending.reject(new Error("connection closed"));
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    } finally {
      process.off("unhandledRejection", unhandled);
    }

    expect(unhandled).not.toHaveBeenCalled();
    expect(lastRender()).toMatchObject({ rooms, archivedRooms: [] });
  });
});
