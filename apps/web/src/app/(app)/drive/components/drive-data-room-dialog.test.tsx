import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));
const router = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
const api = vi.hoisted(() => ({
  createDataRoom: vi.fn(),
  closeDataRoom: vi.fn(),
}));
vi.mock("@/lib/utils/data-room.client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/utils/data-room.client")>()),
  ...api,
}));

import { DriveDataRoomDialog } from "./drive-data-room-dialog";

const store = { scope: "org" as const, organizationId: "org_1" };
const room = {
  id: "room-1",
  folderPath: "Series A",
  storage: "private" as const,
  token: "tok",
  title: null,
  logoFileId: null,
  allowedDomains: [],
  expiresAt: null,
  allowDownload: false,
  watermark: true,
  notifyOnFirstVisit: true,
  createdByUserId: "u1",
  createdAt: "2026-11-09T00:00:00.000Z",
};

describe("DriveDataRoomDialog", () => {
  beforeEach(() => vi.clearAllMocks());

  it("makes the folder a data room and opens it to invite people", async () => {
    api.createDataRoom.mockResolvedValue({ ...room, storage: "moving_in" });
    const onChanged = vi.fn();
    render(
      <DriveDataRoomDialog
        store={store}
        folder={{ path: "Series A", name: "Series A", room: undefined }}
        onOpenChange={() => {}}
        onChanged={onChanged}
      />,
    );
    expect(screen.getByText("makeDescriptionOrg")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "make" }));
    expect(api.createDataRoom).toHaveBeenCalledWith({
      store,
      folderPath: "Series A",
    });
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(toast.success).toHaveBeenCalledWith("made");
    expect(router.push).toHaveBeenCalledWith(
      "/drive/data-rooms/room-1?invite=1",
    );
  });

  it("shows Core's reason when the folder cannot be a room", async () => {
    api.createDataRoom.mockRejectedValue({
      message: "This folder holds a data room; a room cannot hold another",
    });
    render(
      <DriveDataRoomDialog
        store={store}
        folder={{ path: "Deals", name: "Deals", room: undefined }}
        onOpenChange={() => {}}
        onChanged={() => {}}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "make" }));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        "This folder holds a data room; a room cannot hold another",
      ),
    );
    expect(router.push).not.toHaveBeenCalled();
  });

  it("closes a room only after the owner confirms", async () => {
    api.closeDataRoom.mockResolvedValue(undefined);
    render(
      <DriveDataRoomDialog
        store={store}
        folder={{ path: "Series A", name: "Series A", room }}
        onOpenChange={() => {}}
        onChanged={() => {}}
      />,
    );
    expect(screen.getByText("storage.private")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "close" }));
    expect(api.closeDataRoom).not.toHaveBeenCalled();
    expect(await screen.findByText("closeDescription")).toBeInTheDocument();
    const buttons = screen.getAllByRole("button", { name: "close" });
    await userEvent.click(buttons[buttons.length - 1]);
    await waitFor(() =>
      expect(api.closeDataRoom).toHaveBeenCalledWith({
        store,
        roomId: "room-1",
      }),
    );
  });

  it("only points to the room from a folder inside it", () => {
    render(
      <DriveDataRoomDialog
        store={store}
        folder={{ path: "Series A/Legal", name: "Legal", room }}
        onOpenChange={() => {}}
        onChanged={() => {}}
      />,
    );
    expect(screen.getByText("insideRoom")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "close" })).toBeNull();
  });
});
