import { describe, expect, it } from "vitest";

import {
  withoutDesignMdMetadata,
  withPreservedDesignMdMetadata,
} from "../design-md-metadata-guard.js";

describe("withoutDesignMdMetadata", () => {
  it("strips designMd fields and keeps other keys", () => {
    expect(
      withoutDesignMdMetadata({
        url: "https://acme.example",
        designMdUrl: "https://evil.example/ssrf",
        designMdExtractionId: "42",
      }),
    ).toEqual({
      url: "https://acme.example",
    });
  });

  it("returns null when only designMd fields were present", () => {
    expect(
      withoutDesignMdMetadata({
        designMdUrl: "https://evil.example/ssrf",
      }),
    ).toBeNull();
  });
});

describe("withPreservedDesignMdMetadata", () => {
  it("overwrites client designMd fields with existing server values", () => {
    expect(
      withPreservedDesignMdMetadata(
        {
          url: "https://acme.example",
          designMdUrl: "https://evil.example/ssrf",
          designMdExtractionId: "attacker",
        },
        {
          designMdUrl:
            "https://abc.public.blob.vercel-storage.com/design-md/ok.md",
          designMdExtractionId: "99",
          url: "https://old.example",
        },
      ),
    ).toEqual({
      url: "https://acme.example",
      designMdUrl: "https://abc.public.blob.vercel-storage.com/design-md/ok.md",
      designMdExtractionId: "99",
    });
  });

  it("restores designMd fields when client omits or clears them", () => {
    expect(
      withPreservedDesignMdMetadata(
        { url: "https://acme.example" },
        {
          designMdUrl:
            "https://abc.public.blob.vercel-storage.com/design-md/ok.md",
          designMdExtractionId: "99",
        },
      ),
    ).toEqual({
      url: "https://acme.example",
      designMdUrl: "https://abc.public.blob.vercel-storage.com/design-md/ok.md",
      designMdExtractionId: "99",
    });

    expect(
      withPreservedDesignMdMetadata(null, {
        designMdUrl:
          "https://abc.public.blob.vercel-storage.com/design-md/ok.md",
      }),
    ).toEqual({
      designMdUrl: "https://abc.public.blob.vercel-storage.com/design-md/ok.md",
    });
  });

  it("does not invent designMd fields when none exist server-side", () => {
    expect(
      withPreservedDesignMdMetadata(
        {
          url: "https://acme.example",
          designMdUrl: "https://evil.example/ssrf",
        },
        { url: "https://old.example" },
      ),
    ).toEqual({
      url: "https://acme.example",
    });
  });
});
