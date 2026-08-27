import { describe, expect, it } from "vitest";
import {
  getBucketKeyFromMetadata,
  resolveBucketKeyFromDisplaySlug,
} from "./bucket-slug";

describe("getBucketKeyFromMetadata", () => {
  it("returns coworker bucket when only coworker_slug is present", () => {
    expect(
      getBucketKeyFromMetadata({
        type: "coworker",
        coworker_slug: "hannah",
      }),
    ).toBe("coworker:hannah");
  });

  it("prefers coworker_slug over coworker_id", () => {
    expect(
      getBucketKeyFromMetadata({
        type: "coworker",
        coworker_id: "7f5de96e-245f-4f4a-8566-cad4e4f64a48",
        coworker_slug: "elena",
      }),
    ).toBe("coworker:elena");
  });

  it("falls back to coworker id when slug is absent", () => {
    expect(
      getBucketKeyFromMetadata({
        type: "coworker",
        coworker_id: "cow_123",
        model_id: "openai/gpt-5",
      }),
    ).toBe("coworker:cow_123");
  });

  it("returns model bucket for model chats", () => {
    expect(
      getBucketKeyFromMetadata({
        type: "model",
        model_id: "anthropic/claude-sonnet-4",
      }),
    ).toBe("model:anthropic/claude-sonnet-4");
  });
});

describe("resolveBucketKeyFromDisplaySlug", () => {
  it("falls back to coworker slug when coworker matches by display slug", () => {
    expect(
      resolveBucketKeyFromDisplaySlug(
        [],
        [
          {
            id: "cow_123",
            slug: "elena",
            name: "Elena",
          },
        ],
        "elena",
      ),
    ).toBe("coworker:elena");
  });

  it("does not resolve legacy encoded bucket slugs anymore", () => {
    expect(resolveBucketKeyFromDisplaySlug([], [], "coworker__cow_123")).toBe(
      null,
    );
  });
});
