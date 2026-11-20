import type { ChatRoom, DiscoverableChatRoom } from "@sokosumi/core-client";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TestQueryProvider } from "@/test/query-provider";
import { BrowseChannelsDialog } from "./browse-channels-dialog";

const {
  listDiscoverableChannelsActionMock,
  joinRoomActionMock,
  notifyOrganizationChatRoomsChangedMock,
  toastErrorMock,
  toastSuccessMock,
  assignMock,
} = vi.hoisted(() => ({
  listDiscoverableChannelsActionMock: vi.fn(),
  joinRoomActionMock: vi.fn(),
  notifyOrganizationChatRoomsChangedMock: vi.fn(),
  toastErrorMock: vi.fn(),
  toastSuccessMock: vi.fn(),
  assignMock: vi.fn(),
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("sonner", () => ({
  toast: { error: toastErrorMock, success: toastSuccessMock },
}));

vi.mock("@/app/chat/actions", () => ({
  listDiscoverableChannelsAction: (...args: unknown[]) =>
    listDiscoverableChannelsActionMock(...args),
  joinRoomAction: (...args: unknown[]) => joinRoomActionMock(...args),
}));

vi.mock("@/components/chat/organization-chat-events", () => ({
  notifyOrganizationChatRoomsChanged: (...args: unknown[]) =>
    notifyOrganizationChatRoomsChangedMock(...args),
}));

function channel(
  overrides: Partial<DiscoverableChatRoom> = {},
): DiscoverableChatRoom {
  return {
    id: "room-1",
    name: "Engineering",
    slug: "engineering",
    topic: "Build updates",
    discoverability: "public",
    memberCount: 5,
    ...overrides,
  } as DiscoverableChatRoom;
}

describe("BrowseChannelsDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("location", { assign: assignMock });
    listDiscoverableChannelsActionMock.mockResolvedValue({
      ok: true,
      value: [channel()],
    });
    joinRoomActionMock.mockResolvedValue({
      ok: true,
      value: { id: "room-1", name: "Engineering" } as ChatRoom,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("loads discoverable channels when opened and searches after debounce", async () => {
    render(<BrowseChannelsDialog />, { wrapper: TestQueryProvider });

    expect(listDiscoverableChannelsActionMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "trigger" }));
    expect(await screen.findByText("Engineering")).toBeInTheDocument();
    expect(listDiscoverableChannelsActionMock).toHaveBeenCalledWith({ q: "" });

    listDiscoverableChannelsActionMock.mockResolvedValueOnce({
      ok: true,
      value: [channel({ id: "room-2", name: "Design" })],
    });
    fireEvent.change(screen.getByLabelText("searchPlaceholder"), {
      target: { value: "des" },
    });

    await waitFor(() => {
      expect(listDiscoverableChannelsActionMock).toHaveBeenCalledWith({
        q: "des",
      });
    });
    expect(await screen.findByText("Design")).toBeInTheDocument();
  });

  it("toasts and renders empty state when loading channels fails", async () => {
    listDiscoverableChannelsActionMock.mockResolvedValue({
      ok: false,
      error: { message: "Catalog offline" },
    });
    render(<BrowseChannelsDialog />, { wrapper: TestQueryProvider });

    fireEvent.click(screen.getByRole("button", { name: "trigger" }));

    expect(await screen.findByText("empty")).toBeInTheDocument();
    expect(toastErrorMock).toHaveBeenCalledWith("Catalog offline");
  });
});
