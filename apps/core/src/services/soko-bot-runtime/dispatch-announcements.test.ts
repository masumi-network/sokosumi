import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  botIds: [] as string[],
  ownerDirected: vi.fn(),
  save: vi.fn(),
  setLive: vi.fn(),
  publicUrl: vi.fn(),
  receipt: vi.fn(),
}));

vi.mock("@/config/env", () => ({
  getEnv: () => ({ SOKO_BOT_ANNOUNCEMENT_BOT_IDS: m.botIds }),
}));
vi.mock("@/lib/soko-bot/turn-loop", () => ({
  isOwnerDirected: m.ownerDirected,
}));
vi.mock("@/lib/drive-blob", () => ({ publicDriveUrl: m.publicUrl }));
vi.mock("@/lib/db/transaction", () => ({
  serializableTransaction: (run: (tx: unknown) => unknown) => run({}),
}));
vi.mock("@/lib/soko-bot/action-receipts", () => ({
  commitActionReceipt: m.receipt,
}));
vi.mock("@/services/announcements.service", () => ({
  listAnnouncements: vi.fn().mockResolvedValue([]),
  saveAnnouncementDraft: m.save,
  setAnnouncementLive: m.setLive,
}));

import {
  SokoBotRefusedUnsentError,
  SokoBotRuntimeAuthorizationError,
} from "../soko-bot-runtime.service";
import {
  dispatchAnnouncementTools,
  requireAnnouncementBot,
} from "./dispatch-announcements";
import type { RuntimeOperations } from "./operations";

const BOT_ID = "01960001-0001-7001-8001-000000000001";
const ANNOUNCEMENT_ID = "01960001-0001-7001-8001-0000000000aa";
const authorized = {
  turn: { id: "turn-1", sokoBotId: BOT_ID },
} as never;
const runtime = {
  requireMutationAuthority: vi.fn(),
  ownerDriveFile: vi.fn(),
} as unknown as RuntimeOperations;

function call(capability: string, input: unknown) {
  return dispatchAnnouncementTools(
    runtime,
    { capability, input, toolCallId: "call-1", turnId: "turn-1" } as never,
    authorized,
  );
}

const announcement = {
  announcementId: ANNOUNCEMENT_ID,
  live: false,
  title: "New this week",
  summary: "Three changes",
  body: "",
  coverUrl: null,
  action: null,
  closedBy: 0,
  updatedAt: "2026-11-16T10:00:00.000Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  m.botIds = [BOT_ID];
});

describe("announcement tools", () => {
  it("lets only a listed bot use them", () => {
    expect(() => requireAnnouncementBot(BOT_ID)).not.toThrow();
    m.botIds = [];
    expect(() => requireAnnouncementBot(BOT_ID)).toThrow(
      SokoBotRuntimeAuthorizationError,
    );
  });

  it("saves a draft with the cover's public link", async () => {
    vi.mocked(runtime.ownerDriveFile).mockResolvedValue({
      resource: { sourceId: "drive/users/u1/week.mp4" },
    } as never);
    m.publicUrl.mockResolvedValue("https://blob.example/week.mp4");
    m.save.mockResolvedValue(announcement);
    await expect(
      call("save_announcement", {
        title: "New this week",
        summary: "Three changes",
        coverFileId: "file-1",
      }),
    ).resolves.toEqual(announcement);
    expect(m.save).toHaveBeenCalledWith({}, undefined, {
      title: "New this week",
      summary: "Three changes",
      body: "",
      coverUrl: "https://blob.example/week.mp4",
      action: null,
    });
    expect(m.receipt).toHaveBeenCalledOnce();
  });

  it("refuses a cover the popup cannot show", async () => {
    vi.mocked(runtime.ownerDriveFile).mockResolvedValue({
      resource: { sourceId: "drive/users/u1/notes.pdf" },
    } as never);
    await expect(
      call("save_announcement", {
        title: "New",
        summary: "Changes",
        coverFileId: "file-1",
      }),
    ).rejects.toThrow(SokoBotRefusedUnsentError);
    expect(m.save).not.toHaveBeenCalled();
  });

  it("never rewrites a live announcement", async () => {
    m.save.mockResolvedValue("live");
    await expect(
      call("save_announcement", {
        announcementId: ANNOUNCEMENT_ID,
        title: "New",
        summary: "Changes",
      }),
    ).rejects.toThrow(/live/);
    expect(m.receipt).not.toHaveBeenCalled();
  });

  it("publishes only on the owner's word in chat", async () => {
    m.ownerDirected.mockResolvedValue(false);
    await expect(
      call("publish_announcement", {
        announcementId: ANNOUNCEMENT_ID,
        live: true,
      }),
    ).rejects.toThrow(SokoBotRefusedUnsentError);
    expect(m.setLive).not.toHaveBeenCalled();

    m.ownerDirected.mockResolvedValue(true);
    m.setLive.mockResolvedValue({ ...announcement, live: true });
    await expect(
      call("publish_announcement", {
        announcementId: ANNOUNCEMENT_ID,
        live: true,
      }),
    ).resolves.toMatchObject({ live: true });
    expect(m.setLive).toHaveBeenCalledWith({}, ANNOUNCEMENT_ID, true);
  });
});
