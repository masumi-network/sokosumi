import { describe, expect, it } from "vitest";

import {
  buildCoworkerImagePathname,
  buildCoworkerImagePrefix,
  COWORKER_IMAGE_MAX_SIZE_BYTES,
  extensionForCoworkerImageMime,
  isCoworkerImageAllowedContentType,
  isOwnedCoworkerImageUrl,
} from "../coworker-image-upload.js";

describe("isCoworkerImageAllowedContentType", () => {
  it("accepts listed image types (case-insensitive)", () => {
    expect(isCoworkerImageAllowedContentType("image/png")).toBe(true);
    expect(isCoworkerImageAllowedContentType("IMAGE/JPEG")).toBe(true);
    expect(isCoworkerImageAllowedContentType(" image/webp ")).toBe(true);
    expect(isCoworkerImageAllowedContentType("image/gif")).toBe(true);
  });

  it("rejects non-image, svg, and unlisted types", () => {
    expect(isCoworkerImageAllowedContentType("application/pdf")).toBe(false);
    expect(isCoworkerImageAllowedContentType("image/svg+xml")).toBe(false);
    expect(isCoworkerImageAllowedContentType("text/plain")).toBe(false);
  });
});

describe("COWORKER_IMAGE_MAX_SIZE_BYTES", () => {
  it("is 2 MiB", () => {
    expect(COWORKER_IMAGE_MAX_SIZE_BYTES).toBe(2 * 1024 * 1024);
  });
});

describe("extensionForCoworkerImageMime", () => {
  it("maps allowed MIME types to file extensions", () => {
    expect(extensionForCoworkerImageMime("image/png")).toBe("png");
    expect(extensionForCoworkerImageMime("IMAGE/JPEG")).toBe("jpg");
    expect(extensionForCoworkerImageMime("image/webp")).toBe("webp");
    expect(extensionForCoworkerImageMime("image/gif")).toBe("gif");
    expect(extensionForCoworkerImageMime("image/svg+xml")).toBeNull();
  });
});

describe("buildCoworkerImagePathname", () => {
  it("builds a sanitized pathname under the coworker prefix", () => {
    expect(
      buildCoworkerImagePathname(
        "01960001-0001-7001-8001-000000000099",
        " Ops Logo (1).png ",
        "image/png",
      ),
    ).toBe(
      "coworkers/01960001-0001-7001-8001-000000000099/image-Ops_Logo_1.png",
    );
  });

  it("uses the content-type extension when the filename extension differs", () => {
    expect(
      buildCoworkerImagePathname(
        "01960001-0001-7001-8001-000000000099",
        "logo.jpg",
        "image/png",
      ),
    ).toBe("coworkers/01960001-0001-7001-8001-000000000099/image-logo.png");
  });

  it("falls back when the filename is empty after sanitizing", () => {
    expect(
      buildCoworkerImagePathname(
        "01960001-0001-7001-8001-000000000099",
        "@@@",
        "image/webp",
      ),
    ).toBe("coworkers/01960001-0001-7001-8001-000000000099/image-file.webp");
  });
});

describe("buildCoworkerImagePrefix", () => {
  it("returns the coworkers/{id}/ prefix", () => {
    expect(buildCoworkerImagePrefix("cow_123")).toBe("coworkers/cow_123/");
  });
});

describe("isOwnedCoworkerImageUrl", () => {
  const coworkerId = "01960001-0001-7001-8001-000000000099";

  it("accepts https Vercel blob URLs under the coworker prefix", () => {
    expect(
      isOwnedCoworkerImageUrl(
        `https://abc.public.blob.vercel-storage.com/coworkers/${coworkerId}/image-ops-xyz.png`,
        coworkerId,
      ),
    ).toBe(true);
  });

  it("rejects foreign hosts, wrong prefix, and non-https URLs", () => {
    expect(
      isOwnedCoworkerImageUrl(
        `https://evil.example.com/coworkers/${coworkerId}/image.png`,
        coworkerId,
      ),
    ).toBe(false);
    expect(
      isOwnedCoworkerImageUrl(
        `https://abc.public.blob.vercel-storage.com/orchestrators/${coworkerId}/image.png`,
        coworkerId,
      ),
    ).toBe(false);
    expect(
      isOwnedCoworkerImageUrl(
        `http://abc.public.blob.vercel-storage.com/coworkers/${coworkerId}/image.png`,
        coworkerId,
      ),
    ).toBe(false);
    expect(isOwnedCoworkerImageUrl("not-a-url", coworkerId)).toBe(false);
  });
});
