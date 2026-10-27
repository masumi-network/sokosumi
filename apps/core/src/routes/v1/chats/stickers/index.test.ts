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
  const body = new FormData();
  body.set("file", new File([new Uint8Array(bytes)], "wave.png", { type }));
  return { method: "POST", body };
}

describe("saved chat stickers", () => {
  beforeEach(() => blobs.clear());
  it("persists uploads across requests and isolates each user's collection", async () => {
    const uploaded = await appFor("alice").request("/", upload());
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
    [new Uint8Array(2 * 1024 * 1024 + 1), "image/png", 413],
  ])(
    "rejects invalid content/type/size before storage",
    async (bytes, type, status) => {
      const response = await appFor("alice").request("/", upload(bytes, type));
      expect(response.status).toBe(status);
      expect(blobs.size).toBe(0);
    },
  );
  it("rejects URL-only submissions", async () => {
    const body = new FormData();
    body.set("file", "https://example.com/private.png");
    expect(
      (await appFor("alice").request("/", { method: "POST", body })).status,
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
    expect((await app.request("/", upload())).status).toBe(403);
    expect(blobs.size).toBe(0);
  });
});
