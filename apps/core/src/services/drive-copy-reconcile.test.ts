import { beforeEach, describe, expect, it, vi } from "vitest";

import { expectCoreLog } from "@/test/core-log";

const objects = vi.hoisted(
  () => new Map<string, { etag: string; size: number; contentType: string }>(),
);
const failing = vi.hoisted(() => new Set<string>());
vi.mock("@/lib/drive-blob", () => ({
  driveHead: async (pathname: string) => {
    if (failing.has(pathname)) throw new Error("Blob service unavailable");
    return objects.get(pathname) ?? null;
  },
}));

const catalog = vi.hoisted(() => ({
  claims: vi.fn(),
  publish: vi.fn(),
  release: vi.fn(),
}));
vi.mock("@/services/file-catalog.service", () => ({
  recordedDriveCopyClaims: catalog.claims,
  publishDriveCopyResource: catalog.publish,
  releaseDriveCopyResource: catalog.release,
}));

import { reconcileStaleDriveCopies } from "./drive-copy-reconcile";

const claim = (name: string, etag = "e1") => ({
  resourceId: `res-${name}`,
  pathname: `drive/users/u1/${name}`,
  etag,
});

beforeEach(() => {
  vi.clearAllMocks();
  objects.clear();
  failing.clear();
  catalog.publish.mockResolvedValue(true);
});

describe("settling copies a request recorded but did not publish", () => {
  it("only ever asks for claims with a recorded write", async () => {
    catalog.claims.mockResolvedValue([]);

    await reconcileStaleDriveCopies();

    expect(catalog.claims).toHaveBeenCalledWith(expect.any(Date), 50);
  });

  it("publishes the recorded write with its own metadata", async () => {
    const landed = claim("a (copy).md");
    catalog.claims.mockResolvedValue([landed]);
    objects.set(landed.pathname, {
      etag: "e1",
      size: 5,
      contentType: "text/csv",
    });

    expect(await reconcileStaleDriveCopies()).toMatchObject({ published: 1 });
    expect(catalog.publish).toHaveBeenCalledWith({
      ...landed,
      sizeBytes: 5,
      mimeType: "text/csv",
    });
  });

  it("never publishes bytes that are not the recorded write", async () => {
    const other = claim("b (copy).md");
    catalog.claims.mockResolvedValue([other]);
    objects.set(other.pathname, {
      etag: "someone-else",
      size: 5,
      contentType: "text/plain",
    });

    expect(await reconcileStaleDriveCopies()).toMatchObject({ kept: 1 });
    expect(catalog.publish).not.toHaveBeenCalled();
    expect(catalog.release).not.toHaveBeenCalled();
  });

  it("gives back a claim whose recorded write is gone", async () => {
    const gone = claim("c (copy).md");
    catalog.claims.mockResolvedValue([gone]);

    expect(await reconcileStaleDriveCopies()).toMatchObject({ released: 1 });
    expect(catalog.release).toHaveBeenCalledWith({
      resourceId: gone.resourceId,
      pathname: gone.pathname,
    });
  });

  it("isolates a failing claim and still settles the next one", async () => {
    expectCoreLog("warn", "Could not settle a Drive copy");
    const broken = claim("d (copy).md");
    const healthy = claim("e (copy).md");
    catalog.claims.mockResolvedValue([broken, healthy]);
    failing.add(broken.pathname);
    objects.set(healthy.pathname, {
      etag: "e1",
      size: 1,
      contentType: "text/plain",
    });

    expect(await reconcileStaleDriveCopies()).toMatchObject({
      failed: 1,
      published: 1,
    });
  });

  it("stops when the tick has no time left", async () => {
    catalog.claims.mockResolvedValue([claim("f (copy).md")]);

    await reconcileStaleDriveCopies({ shouldContinue: () => false });

    expect(catalog.publish).not.toHaveBeenCalled();
    expect(catalog.release).not.toHaveBeenCalled();
  });
});
