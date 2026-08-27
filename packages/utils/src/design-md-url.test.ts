import { describe, expect, it } from "vitest";

import {
  DESIGN_MD_BLOB_PATH_PREFIX,
  isDesignMdBlobUrl,
} from "./design-md-url.js";

describe("DESIGN_MD_BLOB_PATH_PREFIX", () => {
  it("matches Core upload directory pathname prefix", () => {
    expect(DESIGN_MD_BLOB_PATH_PREFIX).toBe("/design-md/");
  });
});

describe("isDesignMdBlobUrl", () => {
  it("accepts https Vercel public blob URLs under /design-md/", () => {
    expect(
      isDesignMdBlobUrl(
        "https://abc123.public.blob.vercel-storage.com/design-md/hash.md",
      ),
    ).toBe(true);
    expect(
      isDesignMdBlobUrl(
        "https://public.blob.vercel-storage.com/design-md/nested/file.md",
      ),
    ).toBe(true);
    expect(
      isDesignMdBlobUrl(
        "https://abc123.public.blob.vercel-storage.com/design-md/projects/project_123/hash.md",
      ),
    ).toBe(true);
  });

  it("rejects non-https, foreign hosts, and non-design-md paths", () => {
    expect(
      isDesignMdBlobUrl(
        "http://abc123.public.blob.vercel-storage.com/design-md/hash.md",
      ),
    ).toBe(false);
    expect(isDesignMdBlobUrl("https://evil.example/design-md/hash.md")).toBe(
      false,
    );
    expect(
      isDesignMdBlobUrl(
        "https://abc123.public.blob.vercel-storage.com/users/u1/file.md",
      ),
    ).toBe(false);
    expect(isDesignMdBlobUrl("https://169.254.169.254/latest/meta-data/")).toBe(
      false,
    );
    expect(isDesignMdBlobUrl("not-a-url")).toBe(false);
  });
});
