import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  captureExceptionMock,
  delMock,
  getEnvMock,
  putMock,
  ssrfSafeFetchMock,
} = vi.hoisted(() => ({
  captureExceptionMock: vi.fn(),
  delMock: vi.fn(),
  getEnvMock: vi.fn((): { BLOB_READ_WRITE_TOKEN: string | undefined } => ({
    BLOB_READ_WRITE_TOKEN: "blob_token",
  })),
  putMock: vi.fn(),
  ssrfSafeFetchMock: vi.fn(),
}));

vi.mock("@/config/env", () => ({ getEnv: getEnvMock }));
vi.mock("@vercel/blob", () => ({ del: delMock, put: putMock }));
vi.mock("@sokosumi/net", () => ({ ssrfSafeFetch: ssrfSafeFetchMock }));
vi.mock("@sentry/node", () => ({ captureException: captureExceptionMock }));

import {
  deleteChatRoomUnfurlSnapshotsIfOwned,
  snapshotChatRoomUnfurlImage,
} from "./chat-unfurl-snapshot";

const ROOM_ID = "019fa92e-3818-707e-86ea-2db89f35cc23";
const MESSAGE_ID = "01a0aa15-ef43-71c5-9126-c006c8732239";
const SOURCE = "https://jf.x.com/images/post/2100178016617869710.png";
const STORED = `https://abc.public.blob.vercel-storage.com/chats/${ROOM_ID}/unfurls/${MESSAGE_ID}/image-preview-x1.png`;

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** A body that sniffs as PNG (real bytes decide, not the header). */
function pngResponse(size = 1234, contentType = "image/png"): Response {
  const body = new Uint8Array(size);
  body.set(PNG_MAGIC.slice(0, Math.min(size, PNG_MAGIC.length)));
  return new Response(body, {
    status: 200,
    headers: { "content-type": contentType },
  });
}

function bodyResponse(body: string, contentType: string): Response {
  return new Response(body, {
    status: 200,
    headers: { "content-type": contentType },
  });
}

describe("snapshotChatRoomUnfurlImage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getEnvMock.mockReturnValue({ BLOB_READ_WRITE_TOKEN: "blob_token" });
    putMock.mockResolvedValue({ url: STORED });
  });

  it("downloads the image and stores it under the message's prefix", async () => {
    ssrfSafeFetchMock.mockResolvedValue(pngResponse(1234));

    const stored = await snapshotChatRoomUnfurlImage({
      roomId: ROOM_ID,
      messageId: MESSAGE_ID,
      imageUrl: SOURCE,
    });

    expect(stored).toBe(STORED);
    expect(ssrfSafeFetchMock).toHaveBeenCalledWith(
      SOURCE,
      expect.objectContaining({ maxResponseBytes: 5 * 1024 * 1024 }),
    );
    expect(putMock).toHaveBeenCalledWith(
      `chats/${ROOM_ID}/unfurls/${MESSAGE_ID}/image-preview.png`,
      expect.anything(),
      expect.objectContaining({
        access: "public",
        contentType: "image/png",
        token: "blob_token",
        addRandomSuffix: true,
      }),
    );
  });

  it("stores a mislabelled image by its real bytes", async () => {
    ssrfSafeFetchMock.mockResolvedValue(
      pngResponse(64, "application/octet-stream"),
    );

    await expect(
      snapshotChatRoomUnfurlImage({
        roomId: ROOM_ID,
        messageId: MESSAGE_ID,
        imageUrl: SOURCE,
      }),
    ).resolves.toBe(STORED);
    expect(putMock).toHaveBeenCalledWith(
      expect.stringMatching(/image-preview\.png$/),
      expect.anything(),
      expect.objectContaining({ contentType: "image/png" }),
    );
  });

  it.each([
    ["non-OK status", () => new Response("nope", { status: 403 })],
    ["an HTML page", () => bodyResponse("<html>login</html>", "text/html")],
    [
      "an HTML page labelled as an image",
      () => bodyResponse("<html>login</html>", "image/png"),
    ],
    ["svg", () => bodyResponse("<svg xmlns='x'/>", "image/svg+xml")],
    ["empty body", () => bodyResponse("", "image/png")],
  ])("returns null on %s without touching Blob", async (_label, make) => {
    ssrfSafeFetchMock.mockResolvedValue(make());

    await expect(
      snapshotChatRoomUnfurlImage({
        roomId: ROOM_ID,
        messageId: MESSAGE_ID,
        imageUrl: SOURCE,
      }),
    ).resolves.toBeNull();
    expect(putMock).not.toHaveBeenCalled();
  });

  it("returns null when the download throws (timeout, SSRF reject, size cap)", async () => {
    ssrfSafeFetchMock.mockRejectedValue(new Error("exceeds maxResponseBytes"));

    await expect(
      snapshotChatRoomUnfurlImage({
        roomId: ROOM_ID,
        messageId: MESSAGE_ID,
        imageUrl: SOURCE,
      }),
    ).resolves.toBeNull();
    expect(putMock).not.toHaveBeenCalled();
  });

  it("returns null without fetching when Blob is not configured", async () => {
    getEnvMock.mockReturnValue({ BLOB_READ_WRITE_TOKEN: undefined });

    await expect(
      snapshotChatRoomUnfurlImage({
        roomId: ROOM_ID,
        messageId: MESSAGE_ID,
        imageUrl: SOURCE,
      }),
    ).resolves.toBeNull();
    expect(ssrfSafeFetchMock).not.toHaveBeenCalled();
  });

  it("returns null and reports when the Blob put fails", async () => {
    ssrfSafeFetchMock.mockResolvedValue(pngResponse(64));
    putMock.mockRejectedValue(new Error("blob down"));

    await expect(
      snapshotChatRoomUnfurlImage({
        roomId: ROOM_ID,
        messageId: MESSAGE_ID,
        imageUrl: SOURCE,
      }),
    ).resolves.toBeNull();
    expect(captureExceptionMock).toHaveBeenCalledTimes(1);
  });
});

describe("deleteChatRoomUnfurlSnapshotsIfOwned", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getEnvMock.mockReturnValue({ BLOB_READ_WRITE_TOKEN: "blob_token" });
    delMock.mockResolvedValue(undefined);
  });

  it("deletes only URLs under this message's snapshot prefix", async () => {
    const foreign = `https://abc.public.blob.vercel-storage.com/chats/${ROOM_ID}/unfurls/other-message/image-preview-z9.png`;

    await deleteChatRoomUnfurlSnapshotsIfOwned(
      [STORED, SOURCE, foreign, null],
      ROOM_ID,
      MESSAGE_ID,
    );

    expect(delMock).toHaveBeenCalledTimes(1);
    expect(delMock).toHaveBeenCalledWith(STORED, { token: "blob_token" });
  });

  it("swallows and reports delete failures", async () => {
    delMock.mockRejectedValue(new Error("blob down"));

    await expect(
      deleteChatRoomUnfurlSnapshotsIfOwned([STORED], ROOM_ID, MESSAGE_ID),
    ).resolves.toBeUndefined();
    expect(captureExceptionMock).toHaveBeenCalledTimes(1);
  });
});
