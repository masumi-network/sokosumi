import { afterEach, describe, expect, it, vi } from "vitest";

import { saveChatSticker } from "./chat-sticker.browser";

vi.mock("@/lib/clients/utils/core-api-base-url.browser", () => ({
  getBrowserCoreApiBaseUrl: () => "https://core.example/v1",
}));

afterEach(() => vi.unstubAllGlobals());

describe("sticker upload transport", () => {
  it.each(["image/png", "image/jpeg", "image/webp"])(
    "sends unchanged bytes as %s through the generated authenticated client",
    async (type) => {
      const fetch = vi.fn<typeof globalThis.fetch>(async () =>
        Response.json(
          {
            data: { name: "wave.png", url: "https://blob.example/wave.png" },
            meta: {
              timestamp: "2026-10-27T00:00:00.000Z",
              requestId: "test-request",
            },
          },
          { status: 201 },
        ),
      );
      vi.stubGlobal("fetch", fetch);
      const bytes = new Uint8Array([0, 255, 128, 13, 10, 0]);
      const file = new File([bytes], "wave & hello.png", { type });
      const sticker = await saveChatSticker(file);
      const request = new Request(
        fetch.mock.calls[0][0],
        fetch.mock.calls[0][1],
      );
      expect(request.method).toBe("POST");
      expect(request.credentials).toBe("include");
      expect(request.headers.get("Content-Type")).toBe(type);
      expect(new URL(request.url).pathname).toBe("/v1/chats/stickers");
      expect(new URL(request.url).searchParams.get("filename")).toBe(file.name);
      expect(new Uint8Array(await request.arrayBuffer())).toEqual(bytes);
      expect(sticker.name).toBe("wave.png");
    },
  );
});
