import { createHash } from "node:crypto";
import { finalizeEvent, generateSecretKey } from "nostr-tools/pure";
import { beforeEach, describe, expect, it, vi } from "vitest";

const blob = vi.hoisted(() => ({ put: vi.fn() }));
vi.mock("@vercel/blob", () => ({ put: blob.put }));
vi.mock("@/config/env", () => ({
  getEnv: () => ({ BLOB_READ_WRITE_TOKEN: "blob-token" }),
}));

import { relayMediaUrls, withSokosumiMedia } from "./media";

const RELAY = "wss://acme.chat.example";
const bytes = Buffer.from("a picture");
const sha = createHash("sha256").update(bytes).digest("hex");
const fileUrl = `https://acme.chat.example/media/${sha}.png`;

function event(content: string, tags: string[][] = []) {
  return finalizeEvent(
    { kind: 9, created_at: 0, content, tags: [["h", "c"], ...tags] },
    generateSecretKey(),
  );
}

describe("relayMediaUrls", () => {
  it("finds the community's files in the text and in imeta, nowhere else", () => {
    const other = `https://elsewhere.example/media/${sha}.png`;
    const found = relayMediaUrls(
      event(`look ${fileUrl} and ${other}`, [
        [
          "imeta",
          `url https://acme.chat.example/media/${"b".repeat(64)}.jpg`,
          "m image/jpeg",
        ],
      ]),
      RELAY,
    );
    expect(found).toEqual([
      fileUrl,
      `https://acme.chat.example/media/${"b".repeat(64)}.jpg`,
    ]);
  });
});

describe("withSokosumiMedia", () => {
  beforeEach(() => {
    blob.put.mockReset().mockResolvedValue({
      url: "https://store.public.blob.vercel-storage.com/users/u/chats/r/buzz-1.png",
    });
  });

  const copy = (fetchImpl: typeof fetch, content = `see ${fileUrl}`) =>
    withSokosumiMedia({
      content,
      event: event(content),
      relayUrl: RELAY,
      readerKeys: [generateSecretKey(), generateSecretKey()],
      owner: { kind: "user", userId: "u" },
      roomId: "r",
      fetchImpl,
    });

  it("copies a file into the author's chat files and points the message there", async () => {
    const fetchImpl = vi.fn(async (_url: unknown, init?: RequestInit) => {
      const auth = new Headers(init?.headers).get("authorization") ?? "";
      const proof = JSON.parse(
        Buffer.from(auth.slice("Nostr ".length), "base64").toString(),
      ) as { kind: number; tags: string[][] };
      expect(proof.kind).toBe(24242);
      expect(proof.tags).toContainEqual(["x", sha]);
      expect(proof.tags).toContainEqual(["server", "acme.chat.example"]);
      return new Response(bytes, { headers: { "content-type": "image/png" } });
    }) as unknown as typeof fetch;
    await expect(copy(fetchImpl)).resolves.toBe(
      "see https://store.public.blob.vercel-storage.com/users/u/chats/r/buzz-1.png",
    );
    expect(blob.put).toHaveBeenCalledWith(
      `users/u/chats/r/buzz-${sha.slice(0, 16)}.png`,
      bytes,
      expect.objectContaining({ access: "public", allowOverwrite: true }),
    );
  });

  it("tries the next key the relay may let read, and keeps the relay link when none can", async () => {
    const refused = vi.fn(async () => new Response(null, { status: 403 }));
    await expect(copy(refused as unknown as typeof fetch)).resolves.toBe(
      `see ${fileUrl}`,
    );
    expect(refused).toHaveBeenCalledTimes(2);
    expect(blob.put).not.toHaveBeenCalled();
  });

  it("keeps the link when the file is not the one its name says", async () => {
    const wrong = vi.fn(async () => new Response("something else"));
    await expect(copy(wrong as unknown as typeof fetch)).resolves.toBe(
      `see ${fileUrl}`,
    );
    expect(blob.put).not.toHaveBeenCalled();
  });

  it("adds a file only imeta names on its own line", async () => {
    const ok = vi.fn(
      async () => new Response(bytes),
    ) as unknown as typeof fetch;
    const content = "a photo";
    const result = await withSokosumiMedia({
      content,
      event: event(content, [["imeta", `url ${fileUrl}`]]),
      relayUrl: RELAY,
      readerKeys: [generateSecretKey()],
      owner: { kind: "coworker", coworkerId: "k" },
      roomId: "r",
      fetchImpl: ok,
    });
    expect(result).toBe(
      "a photo\nhttps://store.public.blob.vercel-storage.com/users/u/chats/r/buzz-1.png",
    );
    expect(blob.put).toHaveBeenCalledWith(
      `coworkers/k/chats/r/buzz-${sha.slice(0, 16)}.png`,
      bytes,
      expect.anything(),
    );
  });
});
