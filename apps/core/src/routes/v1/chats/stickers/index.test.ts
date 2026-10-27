import { crc32 } from "node:zlib";
import { put } from "@vercel/blob";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OpenAPIHonoWithAuth } from "@/lib/hono";
import mountGet from "./get";
import mountPost from "./post";

vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  const { stubAuthMiddleware } = await import(
    "@/test-fixtures/auth-middleware"
  );
  return { ...actual, authMiddleware: stubAuthMiddleware };
});
vi.mock("@/config/env", () => ({
  getEnv: () => ({ BLOB_READ_WRITE_TOKEN: "test-token" }),
}));
const blobs = vi.hoisted(
  () => new Map<string, { url: string; pathname: string }>(),
);
vi.mock("@vercel/blob", () => ({
  put: vi.fn(async (pathname: string) => {
    const blob = {
      pathname,
      url: `https://test.public.blob.vercel-storage.com/${pathname}`,
    };
    blobs.set(pathname, blob);
    return blob;
  }),
  list: vi.fn(async ({ prefix }: { prefix: string }) => ({
    blobs: [...blobs.values()].filter((blob) =>
      blob.pathname.startsWith(prefix),
    ),
    hasMore: false,
  })),
}));

function appFor(userId: string) {
  const app = new OpenAPIHonoWithAuth();
  app.use("*", async (c, next) => {
    c.set("authContext", {
      actor: "user",
      userId,
      organizationId: null,
      role: "user",
    });
    await next();
  });
  mountGet(app);
  mountPost(app);
  return app;
}
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6f9sAAAAASUVORK5CYII=",
  "base64",
);
function upload(bytes: Uint8Array = png, type = "image/png") {
  return {
    method: "POST",
    body: new Uint8Array(bytes),
    headers: { "Content-Type": type },
  };
}

describe("saved chat stickers", () => {
  beforeEach(() => blobs.clear());
  it("persists uploads across requests and isolates each user's collection", async () => {
    const uploaded = await appFor("alice").request(
      "/?filename=wave.png",
      upload(),
    );
    expect(uploaded.status).toBe(201);
    const sticker = (await uploaded.json()).data;
    expect(sticker.name).toBe("wave.png");
    const reloaded = await appFor("alice").request("/");
    expect((await reloaded.json()).data).toEqual([sticker]);
    const otherUser = await appFor("bob").request("/?userId=alice");
    expect((await otherUser.json()).data).toEqual([]);
  });
  it.each([
    [new Uint8Array(), "image/png", 400],
    [
      new TextEncoder().encode("<svg onload='alert(1)'></svg>"),
      "image/png",
      400,
    ],
    [png, "text/html", 400],
    [png, "application/octet-stream", 400],
    [
      new TextEncoder().encode("https://example.com/private.png"),
      "image/png",
      400,
    ],
    [png, "image/jpeg", 400],
    [new Uint8Array(2 * 1024 * 1024 + 1), "image/png", 413],
  ])(
    "rejects invalid content/type/size before storage",
    async (bytes, type, status) => {
      const response = await appFor("alice").request(
        "/?filename=wave.png",
        upload(bytes, type),
      );
      expect(response.status).toBe(status);
      expect(blobs.size).toBe(0);
    },
  );
  it("accepts exactly 2 MiB of raw PNG bytes without changing stored content", async () => {
    const data = Buffer.alloc(2 * 1024 * 1024 - png.length - 12, 0x20);
    const chunk = Buffer.alloc(data.length + 12);
    chunk.writeUInt32BE(data.length, 0);
    chunk.write("npAD", 4);
    data.copy(chunk, 8);
    chunk.writeUInt32BE(crc32(chunk.subarray(4, -4)), chunk.length - 4);
    const bytes = Buffer.concat([
      png.subarray(0, -12),
      chunk,
      png.subarray(-12),
    ]);
    const response = await appFor("alice").request(
      "/?filename=wave.png",
      upload(bytes),
    );
    expect(response.status).toBe(201);
    expect(put).toHaveBeenLastCalledWith(
      expect.stringMatching(/^stickers\/alice\//),
      bytes,
      expect.objectContaining({ contentType: "image/png" }),
    );
  });
  it("rejects missing filename metadata", async () => {
    expect((await appFor("alice").request("/", upload())).status).toBe(422);
    expect(blobs.size).toBe(0);
  });
  it("rejects URL-only submissions", async () => {
    const body = new FormData();
    body.set("file", "https://example.com/private.png");
    expect(
      (
        await appFor("alice").request("/?filename=wave.png", {
          method: "POST",
          body,
        })
      ).status,
    ).toBe(400);
    expect(blobs.size).toBe(0);
  });
  it("rejects non-user actors", async () => {
    const app = new OpenAPIHonoWithAuth();
    app.use("*", async (c, next) => {
      c.set("authContext", {
        actor: "coworker",
        coworkerId: "bot",
        vendorId: "vendor",
      });
      await next();
    });
    mountGet(app);
    mountPost(app);
    expect((await app.request("/")).status).toBe(403);
    expect((await app.request("/?filename=wave.png", upload())).status).toBe(
      403,
    );
    expect(blobs.size).toBe(0);
  });
});
