import { createHash } from "node:crypto";
import { finalizeEvent, generateSecretKey } from "nostr-tools/pure";
import { beforeEach, describe, expect, it, vi } from "vitest";

const blob = vi.hoisted(() => ({ put: vi.fn() }));
vi.mock("@vercel/blob", () => ({ put: blob.put }));
vi.mock("@/config/env", () => ({
  getEnv: () => ({ BLOB_READ_WRITE_TOKEN: "blob-token" }),
}));

import {
  fitToSokosumi,
  relayMediaUrls,
  withRelayMedia,
  withSokosumiMedia,
} from "./media";

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
      expect.stringMatching(
        new RegExp(
          `^users/u/chats/r/buzz-[0-9a-f]{16}-${sha.slice(0, 16)}\\.png$`,
        ),
      ),
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

  it("fails when the relay does, so the event is tried again", async () => {
    const down = vi.fn(async () => new Response(null, { status: 503 }));
    await expect(copy(down as unknown as typeof fetch)).rejects.toThrow(
      /HTTP 503/,
    );
    expect(blob.put).not.toHaveBeenCalled();
  });

  it("keeps the link when the file is not the one its name says", async () => {
    const wrong = vi.fn(async () => new Response("something else"));
    await expect(copy(wrong as unknown as typeof fetch)).resolves.toBe(
      `see ${fileUrl}`,
    );
    expect(blob.put).not.toHaveBeenCalled();
  });

  it("shows a file the Buzz app attached as Sokosumi shows a file, under its own name", async () => {
    const ok = vi.fn(
      async () => new Response(bytes),
    ) as unknown as typeof fetch;
    const content = `Dream vacation\n\n![DREAM\\_VACATION.png](<${fileUrl}>)`;
    const result = await withSokosumiMedia({
      content,
      event: event(content, [
        [
          "imeta",
          `url ${fileUrl}`,
          "m image/png",
          "filename DREAM_VACATION.png",
        ],
      ]),
      relayUrl: RELAY,
      readerKeys: [generateSecretKey()],
      owner: { kind: "user", userId: "u" },
      roomId: "r",
      fetchImpl: ok,
    });
    expect(result).toBe(
      "Dream vacation\n\n[DREAM_VACATION.png](https://store.public.blob.vercel-storage.com/users/u/chats/r/buzz-1.png)",
    );
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
      "a photo\n\n[buzz-1.png](https://store.public.blob.vercel-storage.com/users/u/chats/r/buzz-1.png)",
    );
    expect(blob.put).toHaveBeenCalledWith(
      expect.stringMatching(
        new RegExp(
          `^coworkers/k/chats/r/buzz-[0-9a-f]{16}-${sha.slice(0, 16)}\\.png$`,
        ),
      ),
      bytes,
      expect.anything(),
    );
  });
});

describe("fitToSokosumi", () => {
  beforeEach(() => {
    blob.put.mockReset().mockResolvedValue({
      url: "https://store.public.blob.vercel-storage.com/full.md",
    });
  });

  it("keeps a message that fits as it is", async () => {
    await expect(
      fitToSokosumi({
        content: "short",
        eventId: "e".repeat(64),
        owner: { kind: "user", userId: "u" },
        roomId: "r",
      }),
    ).resolves.toBe("short");
    expect(blob.put).not.toHaveBeenCalled();
  });

  it("keeps the whole of a longer one in a file it links to", async () => {
    const long = "x".repeat(12_000);
    const fitted = await fitToSokosumi({
      content: long,
      eventId: "e".repeat(64),
      owner: { kind: "user", userId: "u" },
      roomId: "r",
    });
    expect(fitted.length).toBeLessThanOrEqual(10_000);
    expect(fitted).toContain(
      "https://store.public.blob.vercel-storage.com/full.md",
    );
    expect(blob.put).toHaveBeenCalledWith(
      expect.stringMatching(/^users\/u\/chats\/r\/buzz-e{16}-message\.md$/),
      long,
      expect.objectContaining({ access: "public" }),
    );
  });
});

describe("withRelayMedia", () => {
  const chatFile =
    "https://store.public.blob.vercel-storage.com/users/u/chats/r/Report.pdf";
  const picture =
    "https://store.public.blob.vercel-storage.com/users/u/chats/r/photo.png";
  const secretKey = generateSecretKey();

  function relay(status = 200) {
    return vi.fn(async (url: string | URL, init?: RequestInit) => {
      const target = String(url);
      if (target.endsWith("/upload")) {
        const hash = new Headers(init?.headers).get("x-sha-256") ?? "";
        const type = new Headers(init?.headers).get("content-type");
        return status === 200
          ? Response.json({
              url: `https://acme.chat.example/media/${hash}.${type === "image/png" ? "png" : "pdf"}`,
              type,
              size: bytes.length,
              sha256: hash,
              ...(type === "image/png" ? { dim: "10x10" } : {}),
            })
          : new Response("no", { status });
      }
      return new Response(bytes, {
        headers: {
          "content-type": target.endsWith(".png")
            ? "image/png"
            : "application/pdf",
        },
      });
    });
  }

  it("uploads Sokosumi's chat files as the author and attaches them as the Buzz app does", async () => {
    const send = relay();
    const result = await withRelayMedia({
      content: `Numbers\n[Report.pdf](${chatFile})\n[photo.png](${picture})`,
      relayUrl: RELAY,
      secretKey,
      fetchImpl: send as unknown as typeof fetch,
    });
    expect(result.content).toBe(
      `Numbers\n[Report.pdf](<https://acme.chat.example/media/${sha}.pdf>)\n![photo.png](<https://acme.chat.example/media/${sha}.png>)`,
    );
    expect(result.attachments).toEqual([
      [
        "imeta",
        `url https://acme.chat.example/media/${sha}.pdf`,
        "m application/pdf",
        `size ${bytes.length}`,
        `x ${sha}`,
        "filename Report.pdf",
      ],
      [
        "imeta",
        `url https://acme.chat.example/media/${sha}.png`,
        "m image/png",
        `size ${bytes.length}`,
        `x ${sha}`,
        "filename photo.png",
        "dim 10x10",
      ],
    ]);
    const upload = send.mock.calls.find(([url]) =>
      String(url).endsWith("/upload"),
    );
    expect(upload?.[1]?.method).toBe("PUT");
    const auth = JSON.parse(
      Buffer.from(
        String(new Headers(upload?.[1]?.headers).get("authorization")).slice(
          "Nostr ".length,
        ),
        "base64",
      ).toString("utf8"),
    );
    expect(auth.kind).toBe(24242);
    expect(auth.tags).toEqual(
      expect.arrayContaining([
        ["t", "upload"],
        ["x", sha],
        ["server", "acme.chat.example"],
      ]),
    );
  });

  it("keeps a link the relay refuses, and never fetches other hosts", async () => {
    const send = relay(413);
    const content = `[Report.pdf](${chatFile}) and [x.pdf](https://elsewhere.example/users/u/chats/r/x.pdf)`;
    const result = await withRelayMedia({
      content,
      relayUrl: RELAY,
      secretKey,
      fetchImpl: send as unknown as typeof fetch,
    });
    expect(result).toEqual({ content, attachments: [] });
    expect(
      send.mock.calls.some(([url]) => String(url).includes("elsewhere")),
    ).toBe(false);
  });

  it("throws when the relay fails, so the change is tried again", async () => {
    await expect(
      withRelayMedia({
        content: `[Report.pdf](${chatFile})`,
        relayUrl: RELAY,
        secretKey,
        fetchImpl: relay(503) as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/HTTP 503/);
  });
});
