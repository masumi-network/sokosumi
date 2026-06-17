import { describe, expect, it } from "vitest";

import { buildBucketLookupFromCoworkers } from "@/app/history/utils/history-row-subtitle";

describe("buildBucketLookupFromCoworkers", () => {
  it("resolves coworker bucket icons and model bucket icons", () => {
    const result = buildBucketLookupFromCoworkers(
      ["hannah", "gpt-5-4"],
      [
        {
          slug: "hannah",
          name: "Hannah",
          image: "https://example.com/hannah.webp",
        },
      ],
    );

    expect(result.bucketIconBySlug.hannah).toEqual({
      kind: "coworker",
      name: "Hannah",
      imageUrl: "https://example.com/hannah.webp",
    });
    expect(result.bucketIconBySlug["gpt-5-4"]).toEqual({
      kind: "model",
      modelId: "gpt-5-4",
      modelName: "GPT-5.4",
    });
  });
});
